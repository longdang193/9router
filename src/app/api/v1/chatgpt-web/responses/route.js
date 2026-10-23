export const dynamic = "force-dynamic";

import * as zlib from "node:zlib";

export const MAX_RELAY_BODY_BYTES = 8 * 1024 * 1024;

const UPSTREAM_PATH = "/v1/responses";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const FORWARDED_HEADERS = new Set([
  "accept",
  "authorization",
  "content-type",
  "content-encoding",
  "originator",
  "session-id",
  "thread-id",
  "user-agent",
  "version",
  "x-client-request-id",
  "x-codex-beta-features",
  "x-codex-turn-metadata",
  "x-codex-window-id",
]);

function errorResponse(status, message) {
  return new Response(JSON.stringify({
    error: {
      type: "invalid_request_error",
      message,
    },
  }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function parseNativeMetadata(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.request_kind !== "turn") return null;
  if (typeof parsed.thread_id !== "string" || parsed.thread_id.trim() === "") return null;
  if (typeof parsed.turn_id !== "string" || parsed.turn_id.trim() === "") return null;
  return parsed;
}

async function readBoundedBody(request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength)
    && Number(contentLength) > MAX_RELAY_BODY_BYTES) {
    throw Object.assign(new Error("Request body exceeds the relay limit"), { status: 413 });
  }

  if (!request.body) throw Object.assign(new Error("Request body is required"), { status: 400 });
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RELAY_BODY_BYTES) {
        await reader.cancel();
        throw Object.assign(new Error("Request body exceeds the relay limit"), { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function validateUpstreamUrl() {
  const raw = process.env.CODEX_RELAY_UPSTREAM_URL?.trim();
  if (!raw) throw new Error("CODEX_RELAY_UPSTREAM_URL is not configured");

  const url = new URL(raw);
  if (url.protocol !== "http:" || !isLoopbackHost(url.hostname)
    || url.username || url.password || url.search || url.hash
    || url.pathname !== UPSTREAM_PATH) {
    throw new Error("CODEX_RELAY_UPSTREAM_URL must be an http loopback URL at /v1/responses");
  }
  return url;
}

function forwardedHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const normalized = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalized) || !FORWARDED_HEADERS.has(normalized)) continue;
    headers.set(normalized, value);
  }
  return headers;
}

function responseHeaders(response) {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  return headers;
}

function decodeBodyForValidation(body, request) {
  const contentEncoding = (request.headers.get("content-encoding") || "").trim().toLowerCase();
  if (!contentEncoding || contentEncoding === "identity") return body;
  if (contentEncoding !== "zstd") {
    throw Object.assign(new Error("Unsupported request content encoding"), { status: 415 });
  }
  if (typeof zlib.zstdDecompressSync !== "function") {
    throw Object.assign(new Error("zstd request content encoding is unavailable"), { status: 415 });
  }
  try {
    return zlib.zstdDecompressSync(body, { maxOutputLength: MAX_RELAY_BODY_BYTES });
  } catch {
    throw Object.assign(new Error("Request body zstd content is invalid"), { status: 400 });
  }
}

async function relay(request) {
  let incomingUrl;
  try {
    incomingUrl = new URL(request.url);
  } catch {
    return errorResponse(400, "Request URL is invalid");
  }
  if (!isLoopbackHost(incomingUrl.hostname)) return errorResponse(403, "Relay accepts loopback requests only");
  if (request.headers.has("origin")) return errorResponse(403, "Browser-originated relay requests are not accepted");

  const contentType = request.headers.get("content-type") || "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return errorResponse(400, "Relay requests must use Content-Type: application/json");
  }
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/.test(authorization)) return errorResponse(401, "Native Codex Bearer authorization is required");

  let body;
  try {
    body = await readBoundedBody(request);
  } catch (error) {
    return errorResponse(error.status || 400, error.message || "Request body is invalid");
  }

  const validationBody = decodeBodyForValidation(body, request);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(validationBody));
  } catch {
    return errorResponse(400, "Request body must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return errorResponse(400, "Request body must be a JSON object");
  }
  if (typeof parsed.model !== "string" || parsed.model.trim() === "") {
    return errorResponse(400, "Native Codex model is required");
  }
  if (!parsed.client_metadata || typeof parsed.client_metadata !== "object"
    || Array.isArray(parsed.client_metadata)) {
    return errorResponse(400, "Native Codex client_metadata is required");
  }

  const bodyMetadata = parseNativeMetadata(parsed.client_metadata["x-codex-turn-metadata"]);
  const headerMetadataValue = request.headers.get("x-codex-turn-metadata");
  const headerMetadata = parseNativeMetadata(headerMetadataValue);
  if (!bodyMetadata || !headerMetadata || headerMetadataValue !== parsed.client_metadata["x-codex-turn-metadata"]) {
    return errorResponse(400, "Native Codex turn metadata is required and must match");
  }

  let upstreamUrl;
  try {
    upstreamUrl = validateUpstreamUrl();
  } catch (error) {
    return errorResponse(503, error.message);
  }

  const controller = new AbortController();
  const abortUpstream = () => controller.abort();
  if (request.signal.aborted) return new Response(null, { status: 499 });
  request.signal.addEventListener("abort", abortUpstream, { once: true });
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: forwardedHeaders(request),
      body,
      redirect: "manual",
      signal: controller.signal,
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return errorResponse(502, "Relay upstream redirects are not accepted");
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream),
    });
  } catch (error) {
    if (request.signal.aborted || controller.signal.aborted) return new Response(null, { status: 499 });
    return errorResponse(502, error instanceof Error ? error.message : "Relay upstream request failed");
  } finally {
    request.signal.removeEventListener("abort", abortUpstream);
  }
}

export async function GET() {
  return new Response("Responses WebSocket transport is not enabled on this local route", {
    status: 426,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request) {
  return relay(request);
}

export async function OPTIONS() {
  return errorResponse(405, "Relay preflight is not accepted");
}
