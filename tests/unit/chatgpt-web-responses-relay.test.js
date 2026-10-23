import { beforeEach, describe, expect, it, vi } from "vitest";
import { zstdCompressSync } from "node:zlib";

const RELAY_URL = "http://127.0.0.1:20128/v1/chatgpt-web/responses";
const METADATA = JSON.stringify({
  request_kind: "turn",
  thread_id: "thread_native_123",
  turn_id: "turn_native_456",
});
const BODY = JSON.stringify({
  model: "chatgpt-web/medium",
  stream: true,
  input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
  client_metadata: { "x-codex-turn-metadata": METADATA },
});

function request(overrides = {}) {
  const requestUrl = overrides.url || RELAY_URL;
  const headers = new Headers(overrides.headers instanceof Headers ? overrides.headers : {
    accept: "text/event-stream",
    authorization: "Bearer native-codex-token",
    "content-type": "application/json",
    originator: "codex_cli_rs",
    "session-id": "session_native_123",
    "thread-id": "thread_native_123",
    "user-agent": "codex_cli_rs/0.162.0",
    version: "0.162.0",
    "x-client-request-id": "request_native_123",
    "x-codex-beta-features": "responses=1",
    "x-codex-turn-metadata": METADATA,
    "x-codex-window-id": "window_native_123",
    ...overrides.headers,
  });
  return new Request(requestUrl, {
    method: overrides.method || "POST",
    headers,
    body: overrides.body === undefined ? BODY : overrides.body,
    signal: overrides.signal,
  });
}

describe("dedicated Codex Web Responses relay", () => {
  let relay;

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env.CODEX_RELAY_UPSTREAM_URL = "http://127.0.0.1:17841/v1/responses";
    relay = await import("../../src/app/api/v1/chatgpt-web/responses/route.js");
  });

  it("returns 426 for native WebSocket negotiation without contacting upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await relay.GET();

    expect(response.status).toBe(426);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts Next canonical localhost request URLs", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await relay.POST(request({ url: "http://localhost:20128/v1/chatgpt-web/responses" }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards the original body bytes and the observed native header set", async () => {
    const sse = new TextEncoder().encode("event: response.completed\ndata: {\"ok\":true}\n\n");
    const fetchMock = vi.fn(async (_url, init) => new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await relay.POST(request({ headers: {
      "x-request-id": "should-not-forward",
      "ChatGPT-Account-ID": "should-not-forward",
      connection: "close",
    } }));
    const [url, init] = fetchMock.mock.calls[0];
    const forwardedBody = new Uint8Array(await new Response(init.body).arrayBuffer());

    expect(url.toString()).toBe(process.env.CODEX_RELAY_UPSTREAM_URL);
    expect(Buffer.from(forwardedBody).equals(Buffer.from(new TextEncoder().encode(BODY)))).toBe(true);
    expect(init.redirect).toBe("manual");
    expect(init.method).toBe("POST");
    expect(init.headers.get("authorization")).toBe("Bearer native-codex-token");
    expect(init.headers.get("x-codex-turn-metadata")).toBe(METADATA);
    expect(init.headers.get("x-request-id")).toBeNull();
    expect(init.headers.get("chatgpt-account-id")).toBeNull();
    expect(init.headers.get("connection")).toBeNull();
    expect(await response.text()).toBe("event: response.completed\ndata: {\"ok\":true}\n\n");
  });

  it("validates zstd-compressed native JSON while forwarding compressed bytes unchanged", async () => {
    const compressedBody = zstdCompressSync(Buffer.from(BODY));
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await relay.POST(request({
      body: compressedBody,
      headers: { "content-encoding": "zstd" },
    }));

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const forwardedBody = new Uint8Array(await new Response(init.body).arrayBuffer());
    expect(Buffer.from(forwardedBody).equals(compressedBody)).toBe(true);
    expect(init.headers.get("content-encoding")).toBe("zstd");
  });

  it("allows omission of optional observed headers but fails closed for required identity headers", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    for (const name of ["accept", "user-agent", "originator", "version", "x-client-request-id", "x-codex-beta-features", "x-codex-window-id", "session-id", "thread-id"]) {
      const headers = new Headers(request().headers);
      headers.delete(name);
      const response = await relay.POST(request({ headers }));
      expect(response.status, name).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(9);

    const missingAuthorization = new Headers(request().headers);
    missingAuthorization.delete("authorization");
    expect((await relay.POST(request({ headers: missingAuthorization }))).status).toBe(401);

    const missingContentType = new Headers(request().headers);
    missingContentType.delete("content-type");
    expect((await relay.POST(request({ headers: missingContentType }))).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("rejects generic, browser-originated, malformed, and oversized requests before forwarding", async () => {
    const fetchMock = vi.fn(async () => new Response("unexpected", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const generic = new Headers(request().headers);
    generic.delete("x-codex-turn-metadata");
    expect((await relay.POST(request({ headers: generic }))).status).toBe(400);

    expect((await relay.POST(request({ headers: { origin: "https://example.test" } }))).status).toBe(403);
    expect((await relay.POST(request({ body: "not-json" }))).status).toBe(400);
    expect((await relay.POST(request({ body: "{}" }))).status).toBe(400);
    expect((await relay.POST(request({ headers: { "content-length": String(8 * 1024 * 1024 + 1) }, body: "{}" }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid upstream destinations and redirects without replay", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:1/v1/responses" } }));
    vi.stubGlobal("fetch", fetchMock);

    const valid = await relay.POST(request());
    expect(valid.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    process.env.CODEX_RELAY_UPSTREAM_URL = "http://10.0.0.1:17841/v1/responses";
    expect((await relay.POST(request())).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves upstream SSE errors and failed completions without parsing", async () => {
    const upstreamBytes = "event: error\ndata: {\"error\":{\"type\":\"server_error\"}}\n\nevent: response.failed\ndata: {\"response\":{\"status\":\"failed\"}}\n\n";
    const fetchMock = vi.fn(async () => new Response(upstreamBytes, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await relay.POST(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(upstreamBytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("returns one network failure without retrying", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("upstream unavailable"); });
    vi.stubGlobal("fetch", fetchMock);

    const response = await relay.POST(request());

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts the single upstream request when the client disconnects", async () => {
    const client = new AbortController();
    const fetchMock = vi.fn((_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = relay.POST(request({ signal: client.signal }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    client.abort();
    const response = await pending;

    expect(response.status).toBe(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
