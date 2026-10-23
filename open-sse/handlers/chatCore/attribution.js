import { randomUUID } from "node:crypto";

function readHeader(headers, name) {
  if (!headers || typeof headers !== "object") return null;
  const value = headers[name] ?? headers[name.toLowerCase()];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : null;
}

export function createRequestAttribution(headers) {
  return {
    routerRecordId: randomUUID(),
    experimentRequestId: readHeader(headers, "x-lightrsi-request-id"),
    providerAttemptId: readHeader(headers, "x-lightrsi-provider-attempt-id"),
  };
}
