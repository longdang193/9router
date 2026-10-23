import { createServer } from "node:http";
import { Readable } from "node:stream";
import { performance } from "node:perf_hooks";
import { POST } from "../../src/app/api/v1/chatgpt-web/responses/relay.mjs";

const REQUEST_COUNT = Number(process.env.CODEX_RELAY_BENCHMARK_REQUESTS || 100);
const RUN_COUNT = Number(process.env.CODEX_RELAY_BENCHMARK_RUNS || 2);
const BODY = Buffer.from(JSON.stringify({
  model: "chatgpt-web/medium",
  stream: true,
  input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "benchmark" }] }],
  client_metadata: {
    "x-codex-turn-metadata": JSON.stringify({
      request_kind: "turn",
      thread_id: "thread_benchmark",
      turn_id: "turn_benchmark",
    }),
  },
}));
const HEADERS = {
  accept: "text/event-stream",
  authorization: "Bearer benchmark-token",
  "content-type": "application/json",
  originator: "codex_cli_rs",
  "session-id": "session_benchmark",
  "thread-id": "thread_benchmark",
  "user-agent": "codex_cli_rs/benchmark",
  version: "benchmark",
  "x-client-request-id": "request_benchmark",
  "x-codex-beta-features": "responses=1",
  "x-codex-turn-metadata": JSON.parse(BODY).client_metadata["x-codex-turn-metadata"],
  "x-codex-window-id": "window_benchmark",
};

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return Number(sorted[index].toFixed(3));
}

function createUpstreamServer(state) {
  return createServer(async (request, response) => {
    state.requests += 1;
    response.on("close", () => {
      if (!response.writableEnded) state.disconnects += 1;
    });
    for await (const _chunk of request) {
      // Drain the request before emitting the deterministic response.
    }
    response.statusCode = 200;
    response.setHeader("content-type", "text/event-stream");
    response.setHeader("cache-control", "no-cache");
    response.write("event: response.output_text.delta\ndata: {\"delta\":\"ok\"}\n\n");
    response.end("event: response.completed\ndata: {\"status\":\"completed\"}\n\n");
  });
}

function createRelayServer() {
  return createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = `http://${request.headers.host}${request.url}`;
    const relayRequest = new Request(url, {
      method: request.method,
      headers: request.headers,
      body,
    });
    const relayResponse = await POST(relayRequest);
    response.statusCode = relayResponse.status;
    for (const [name, value] of relayResponse.headers) response.setHeader(name, value);
    if (!relayResponse.body) {
      response.end();
      return;
    }
    Readable.fromWeb(relayResponse.body).pipe(response);
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("benchmark server did not bind");
  return address.port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function requestOnce(url) {
  const startedAt = performance.now();
  const response = await fetch(url, { method: "POST", headers: HEADERS, body: BODY });
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`missing response body (${response.status})`);
  let firstChunkAt = null;
  try {
    while (true) {
      const chunk = await reader.read();
      if (firstChunkAt === null) firstChunkAt = performance.now();
      if (chunk.done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!response.ok) throw new Error(`unexpected response status ${response.status}`);
  return {
    ttftMs: firstChunkAt - startedAt,
    totalMs: performance.now() - startedAt,
  };
}

async function measurePath(name, url, upstreamState) {
  for (let index = 0; index < 10; index += 1) await requestOnce(url);
  const beforeRequests = upstreamState.requests;
  const beforeDisconnects = upstreamState.disconnects;
  const beforeCpu = process.cpuUsage();
  const beforeRss = process.memoryUsage().rss;
  let peakRss = beforeRss;
  const ttft = [];
  const total = [];
  const errorClasses = {};
  let errors = 0;
  for (let index = 0; index < REQUEST_COUNT; index += 1) {
    try {
      const result = await requestOnce(url);
      ttft.push(result.ttftMs);
      total.push(result.totalMs);
    } catch (error) {
      errors += 1;
      const key = error instanceof Error ? error.constructor.name : typeof error;
      errorClasses[key] = (errorClasses[key] || 0) + 1;
    }
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const cpu = process.cpuUsage(beforeCpu);
  const attempts = upstreamState.requests - beforeRequests;
  return {
    name,
    requests: REQUEST_COUNT,
    p50TtftMs: percentile(ttft, 0.5),
    p95TtftMs: percentile(ttft, 0.95),
    p50TotalMs: percentile(total, 0.5),
    p95TotalMs: percentile(total, 0.95),
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    peakRssDeltaBytes: peakRss - beforeRss,
    retryCount: Math.max(0, attempts - REQUEST_COUNT),
    streamDisconnects: upstreamState.disconnects - beforeDisconnects,
    errors,
    errorClasses,
  };
}

const upstreamState = { requests: 0, disconnects: 0 };
const upstream = createUpstreamServer(upstreamState);
const relay = createRelayServer();
const upstreamPort = await listen(upstream);
process.env.CODEX_RELAY_UPSTREAM_URL = `http://127.0.0.1:${upstreamPort}/v1/responses`;
const relayPort = await listen(relay);

try {
  const results = [];
  for (let run = 1; run <= RUN_COUNT; run += 1) {
    results.push({
      run,
      paths: [
        await measurePath("relay", `http://127.0.0.1:${relayPort}/v1/chatgpt-web/responses`, upstreamState),
        await measurePath("direct", `http://127.0.0.1:${upstreamPort}/v1/responses`, upstreamState),
      ],
    });
  }
  console.log(JSON.stringify({
    schemaVersion: 1,
    node: process.version,
    requestsPerPath: REQUEST_COUNT,
    runs: RUN_COUNT,
    payloadBytes: BODY.byteLength,
    results,
  }, null, 2));
} finally {
  await close(relay);
  await close(upstream);
}
