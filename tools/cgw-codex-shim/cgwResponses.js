import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

function errorWithState(message, dispatchStarted, code, statusCode) {
  const error = new Error(message);
  error.dispatchStarted = dispatchStarted;
  error.code = code;
  if (statusCode) error.statusCode = statusCode;
  return error;
}

function normalizeBearer(value) {
  const token = String(value || "").trim();
  if (!token) return null;
  return token.replace(/^Bearer\s+/i, "").trim() || null;
}

function normalizeCorrelation(correlation) {
  if (!correlation || !/^[A-Za-z0-9._:-]{1,128}$/.test(correlation.requestId || "") || !/^[0-9a-f]{64}$/.test(correlation.promptFingerprint || "")) {
    return undefined;
  }
  return { requestId: correlation.requestId, promptFingerprint: correlation.promptFingerprint };
}

async function readResponseTextBounded(response, maxBytes) {
  const limit = Number(maxBytes);
  if (!Number.isInteger(limit) || limit < 1 || !response.body?.getReader) {
    const rawText = await response.text();
    if (Number.isInteger(limit) && limit > 0 && Buffer.byteLength(rawText, "utf8") > limit) {
      throw errorWithState("CGW response body too large", true, "cgw_response_too_large", 502);
    }
    return rawText;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw errorWithState("CGW response body too large", true, "cgw_response_too_large", 502);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function readBearerToken(filePath) {
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*(?:CGW_SHIM_CGW_BEARER|OPENAI_ACCESS_TOKEN|ACCESS_TOKEN)\s*=\s*(.*?)\s*$/);
    if (match) return normalizeBearer(match[1]);
  }
  return normalizeBearer(readFileSync(filePath, "utf8"));
}

export function resolveBearer(config, sourceEnv = process.env) {
  const direct = normalizeBearer(sourceEnv.CGW_SHIM_CGW_BEARER);
  if (direct) return direct;
  if (config.cgw.bearerFile) {
    const fileValue = readBearerToken(config.cgw.bearerFile);
    if (fileValue) return fileValue;
  }
  throw errorWithState(
    "CGW bearer is not configured; set CGW_SHIM_CGW_BEARER or CGW_SHIM_CGW_BEARER_FILE",
    false,
    "cgw_bearer_missing",
    503,
  );
}

export function buildCgwResponseRequest({ baseUrl, bearer, model, prompt, reasoningEffort, correlation, generationId, signal }) {
  const url = new URL("responses", `${String(baseUrl).replace(/\/$/, "")}/`);
  const threadId = `thread_${randomUUID()}`;
  const turnId = `turn_${randomUUID()}`;
  const itemId = `msg_${randomUUID()}`;
  const body = {
    model,
    input: [{
      type: "message",
      id: itemId,
      role: "user",
      content: [{ type: "input_text", text: prompt }],
      internal_chat_message_metadata_passthrough: { turn_id: turnId },
    }],
    client_metadata: {
      "x-codex-turn-metadata": JSON.stringify({ request_kind: "turn", thread_id: threadId, turn_id: turnId }),
    },
    store: false,
    stream: false,
  };
  if (reasoningEffort) body.reasoning = { effort: mapReasoningEffort(reasoningEffort) };
  const safeCorrelation = normalizeCorrelation(correlation);
  return {
    url,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        ...(safeCorrelation?.requestId ? { "x-9router-request-id": safeCorrelation.requestId } : {}),
        ...(safeCorrelation?.promptFingerprint ? { "x-9router-prompt-fingerprint": safeCorrelation.promptFingerprint } : {}),
        ...(generationId ? { "x-lightrsi-generation-id": generationId } : {}),
      },
      body: JSON.stringify(body),
      signal,
    },
  };
}

export function mapReasoningEffort(reasoningEffort) {
  return reasoningEffort === "low" ? "instant" : reasoningEffort;
}

export function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const finalOutput = output.filter((item) => item?.phase === "final_answer");
  const items = (finalOutput.length ? finalOutput : output)
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((item) => item?.text || item?.value || "")
    .filter((value) => typeof value === "string" && value.trim());
  const text = items.at(-1) || "";
  return text.trim() ? text : null;
}

export async function runCgwTurn({ config, model, prompt, reasoningEffort, correlation, generationId, signal, bearer, fetchImpl = fetch }) {
  const resolvedBearer = bearer || resolveBearer(config);
  const timeoutSignal = AbortSignal.timeout(config.limits.timeoutMs);
  const requestSignal = signal && AbortSignal.any ? AbortSignal.any([signal, timeoutSignal]) : signal || timeoutSignal;
  const request = buildCgwResponseRequest({
    baseUrl: config.cgw.baseUrl,
    bearer: resolvedBearer,
    model,
    prompt,
    reasoningEffort,
    correlation,
    generationId,
    signal: requestSignal,
  });

  let response;
  try {
    response = await fetchImpl(request.url, request.init);
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw errorWithState("CGW request timed out or was aborted", true, "cgw_request_aborted", 504);
    }
    throw errorWithState(error?.message || "CGW request failed", true, "cgw_request_failed", 502);
  }

  let rawText;
  try {
    rawText = await readResponseTextBounded(response, config.limits.maxOutputBytes);
  } catch (error) {
    if (error?.code === "cgw_response_too_large") throw error;
    throw errorWithState(error?.message || "CGW response could not be read", true, "cgw_response_read_failed", 502);
  }
  let payload = null;
  try { payload = rawText ? JSON.parse(rawText) : null; } catch {}
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.error || rawText;
    throw errorWithState(
      `CGW HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`,
      true,
      "cgw_upstream_error",
      response.status,
    );
  }

  if (payload?.model !== model) {
    throw errorWithState(
      `CGW model mismatch: requested ${model}, received ${payload?.model || "<missing>"}`,
      true,
      "cgw_model_mismatch",
      502,
    );
  }

  const text = extractResponseText(payload);
  if (!text) throw errorWithState("CGW returned no assistant text", true, "cgw_empty_response", 502);
  return { text, dispatchStarted: true, model: payload.model };
}
