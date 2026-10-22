import { createHash, randomUUID } from "node:crypto";

const SAFE_UPSTREAM_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_FINGERPRINT = /^[0-9a-f]{64}$/;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function promptInput(body) {
  if (!body || typeof body !== "object") return null;
  if (Array.isArray(body.messages)) return { format: "messages", value: body.messages };
  if (Array.isArray(body.input)) return { format: "input", value: body.input };
  if (Array.isArray(body.contents)) return { format: "contents", value: body.contents };
  return { format: "body", value: body };
}

export function promptFingerprint(body) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(promptInput(body) || { format: "empty", value: null })))
    .digest("hex");
}

export function buildRequestCorrelation({ serverRequestId, body }) {
  const requestId = typeof serverRequestId === "string" && SAFE_REQUEST_ID.test(serverRequestId)
    ? serverRequestId
    : randomUUID();
  return { requestId, promptFingerprint: promptFingerprint(body) };
}

export function correlationHeaders(correlation) {
  if (!correlation || !SAFE_REQUEST_ID.test(correlation.requestId || "") || !SAFE_FINGERPRINT.test(correlation.promptFingerprint || "")) return {};
  return {
    "x-9router-request-id": correlation.requestId,
    "x-9router-prompt-fingerprint": correlation.promptFingerprint,
  };
}

function safeText(value) {
  return typeof value === "string"
    ? value.replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]").replace(/[\r\n\0]/g, " ").trim().slice(0, 500)
    : "";
}

function safeUpstreamId(value) {
  const candidate = safeText(value);
  return candidate && SAFE_UPSTREAM_ID.test(candidate) ? candidate : "";
}

function responseOptions(response, headers) {
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
  };
}

export async function sanitizeErrorResponse(response, serverRequestId = crypto.randomUUID()) {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", serverRequestId);
  let source;
  try { source = await response.clone().json(); } catch { source = null; }
  const sourceError = source?.error && typeof source.error === "object" && !Array.isArray(source.error) ? source.error : {};
  const error = { message: safeText(sourceError.message) || "Upstream request failed" };
  for (const key of ["type", "param", "code"]) {
    const value = safeText(sourceError[key]);
    if (value) error[key] = value;
  }
  error.request_id = serverRequestId;
  const upstreamRequestId = safeUpstreamId(sourceError.upstream_request_id || sourceError.request_id);
  if (upstreamRequestId && upstreamRequestId !== serverRequestId) error.upstream_request_id = upstreamRequestId;
  headers.delete("content-length");

  return new Response(JSON.stringify({ error }), responseOptions(response, headers));
}

export async function correlateResponse(response, serverRequestId = crypto.randomUUID()) {
  if (!(response instanceof Response)) return response;
  if (response.status >= 400) return sanitizeErrorResponse(response, serverRequestId);
  const headers = new Headers(response.headers);
  headers.set("x-request-id", serverRequestId);
  return new Response(response.body, responseOptions(response, headers));
}
