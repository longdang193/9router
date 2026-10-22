import http from "node:http";
import { randomUUID } from "node:crypto";
import { errorResponse, jsonResponse, parseBearerToken, validateChatRequest } from "./http.js";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_FINGERPRINT = /^[0-9a-f]{64}$/;

function readCorrelation(headers) {
  const requestId = headers["x-9router-request-id"];
  const promptFingerprint = headers["x-9router-prompt-fingerprint"];
  if (!SAFE_REQUEST_ID.test(requestId || "") || !SAFE_FINGERPRINT.test(promptFingerprint || "")) return undefined;
  return { requestId, promptFingerprint };
}

class WorkQueue {
  constructor(maxConcurrent, maxQueue) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueue = maxQueue;
    this.active = 0;
    this.queue = [];
  }

  run(task, signal) {
    return new Promise((resolve, reject) => {
      const item = { task, resolve, reject, signal, onAbort: null };
      if (this.active < this.maxConcurrent) {
        this.start(item);
      } else if (this.queue.length < this.maxQueue) {
        this.queue.push(item);
        if (signal) {
          item.onAbort = () => {
            const index = this.queue.indexOf(item);
            if (index === -1) return;
            this.queue.splice(index, 1);
            signal.removeEventListener("abort", item.onAbort);
            reject(signal.reason || new Error("request aborted while queued"));
          };
          signal.addEventListener("abort", item.onAbort, { once: true });
          if (signal.aborted) item.onAbort();
        }
      } else {
        const error = new Error("CGW execution queue is full");
        error.statusCode = 429;
        reject(error);
      }
    });
  }

  start(item) {
    this.active += 1;
    if (item.onAbort) {
      item.signal?.removeEventListener("abort", item.onAbort);
      item.onAbort = null;
    }
    Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) this.start(next);
    });
  }
}

function writeResponse(response, body, status = 200, headers = {}) {
  const payload = Buffer.from(body);
  response.writeHead(status, { "content-length": payload.length, ...headers });
  response.end(payload);
}

function writeJson(response, body, status = 200, headers = {}) {
  writeResponse(response, JSON.stringify(body), status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
}

function writeSse(response, { id, model, text }) {
  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  const created = Math.floor(Date.now() / 1000);
  const write = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  write({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] });
  write({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  response.write("data: [DONE]\n\n");
  response.end();
}

async function readNodeBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("request body too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("request body must be valid JSON"), { statusCode: 400 });
  }
}

export function createRequestHandler({ config, executeTurn }) {
  const queue = new WorkQueue(config.limits.maxConcurrent, config.limits.maxQueue);
  const activeControllers = new Set();
  const generationExecutions = new Map();
  const maxGenerationExecutions = Math.max(1, Number(config.limits.maxGenerationExecutions || 1024));

  const executeGeneration = ({ generationId, task, signal }) => {
    if (!generationId) return queue.run(task, signal);
    const existing = generationExecutions.get(generationId);
    if (existing) return existing;
    const execution = queue.run(task, signal);
    generationExecutions.set(generationId, execution);
    while (generationExecutions.size > maxGenerationExecutions) {
      const oldest = generationExecutions.keys().next().value;
      if (oldest === undefined) break;
      generationExecutions.delete(oldest);
    }
    return execution;
  };

  const requestHandler = async function requestHandler(request, response) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/health") {
      writeJson(response, { ok: true, service: "cgw-codex-shim" });
      return;
    }

    if (parseBearerToken(request.headers.authorization) !== config.apiKey) {
      writeJson(response, { error: { message: "invalid bearer token", type: "authentication_error" } }, 401, { "www-authenticate": "Bearer" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      writeJson(response, {
        object: "list",
        data: Object.keys(config.modelAliases).map((id) => ({ id, object: "model", owned_by: "cgw-codex-shim" })),
      });
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      writeJson(response, { error: { message: "not found", type: "not_found" } }, 404);
      return;
    }

    let body;
    try {
      body = await readNodeBody(request, config.limits.maxBodyBytes);
    } catch (error) {
      writeJson(response, { error: { message: error.message, type: "invalid_request_error" } }, error.statusCode || 400);
      return;
    }

    let requestInfo;
    try {
      requestInfo = validateChatRequest(body, config.modelAliases);
    } catch (error) {
      writeJson(response, { error: { message: error.message, type: "invalid_request_error" } }, 400);
      return;
    }

    const abortController = new AbortController();
    activeControllers.add(abortController);
    const onAborted = () => abortController.abort(new Error("client disconnected"));
    const onRequestClose = () => { if (!request.complete) onAborted(); };
    const onResponseClose = () => { if (!response.writableEnded) onAborted(); };
    request.once("aborted", onAborted);
    request.once("close", onRequestClose);
    response.once("close", onResponseClose);
    const rawGenerationId = request.headers["x-lightrsi-generation-id"]
      || request.headers["x-lightrsi-request-id"];
    const generationId = Array.isArray(rawGenerationId)
      ? rawGenerationId[0]?.trim()
      : typeof rawGenerationId === "string"
        ? rawGenerationId.trim()
        : undefined;
    const id = `chatcmpl-${randomUUID()}`;
    try {
      const result = await executeGeneration({
        generationId,
        signal: abortController.signal,
        task: () => executeTurn({
          model: requestInfo.model,
          prompt: requestInfo.prompt,
          reasoningEffort: requestInfo.reasoningEffort,
          correlation: readCorrelation(request.headers),
          signal: abortController.signal,
          generationId,
        }),
      });
      if (response.destroyed) return;
      if (body.stream === true) {
        writeSse(response, { id, model: body.model, text: result.text });
      } else {
        writeJson(response, {
          id,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
        });
      }
    } catch (error) {
      if (response.destroyed) return;
      const headers = {
        ...(error.dispatchStarted ? { "x-9router-no-replay": "1" } : {}),
        ...(generationId ? { "x-lightrsi-generation-id": generationId } : {}),
      };
      writeJson(response, { error: { message: error.message || "native execution failed", type: "upstream_error", code: error.code || "native_execution_failed" } }, error.statusCode || 502, headers);
    } finally {
      activeControllers.delete(abortController);
      request.off("aborted", onAborted);
      request.off("close", onRequestClose);
      response.off("close", onResponseClose);
    }
  };

  requestHandler.shutdown = () => {
    for (const controller of activeControllers) {
      controller.abort(new Error("server shutting down"));
    }
  };

  return requestHandler;
}

export async function startServer({ config, executeTurn }) {
  const requestHandler = createRequestHandler({ config, executeTurn });
  const server = http.createServer((request, response) => {
    void requestHandler(request, response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  return {
    server,
    address: server.address(),
    close: () => new Promise((resolve, reject) => {
      requestHandler.shutdown();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
