import { describe, expect, it } from "vitest";

import {
  buildRequestCorrelation,
  correlationHeaders,
  correlateResponse,
} from "../../src/sse/utils/requestCorrelation.js";

describe("privacy-safe request correlation", () => {
  it("overwrites spoofable request IDs and preserves upstream ID separately", async () => {
    const response = await correlateResponse(
      new Response(JSON.stringify({ error: { message: "bad", request_id: "client-spoof" } }), { status: 400 }),
      "server-123"
    );
    const body = await response.json();

    expect(response.headers.get("x-request-id")).toBe("server-123");
    expect(body.error.request_id).toBe("server-123");
    expect(body.error.request_id).not.toBe("client-spoof");
  });

  it("keeps validated provider ID as upstream_request_id", async () => {
    const response = await correlateResponse(
      new Response(JSON.stringify({ error: { message: "bad", request_id: "upstream-123" } }), { status: 502 }),
      "server-456"
    );

    expect(await response.json()).toEqual({
      error: { message: "bad", request_id: "server-456", upstream_request_id: "upstream-123" },
    });
  });

  it("gives identical prompts the same digest without retaining prompt text", () => {
    const first = buildRequestCorrelation({
      serverRequestId: "server-request-1",
      body: { model: "maintained-combo", messages: [{ role: "user", content: "same prompt" }] },
    });
    const second = buildRequestCorrelation({
      serverRequestId: "server-request-2",
      body: { model: "maintained-combo", messages: [{ role: "user", content: "same prompt" }] },
    });

    expect(first.requestId).toBe("server-request-1");
    expect(first.promptFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.promptFingerprint).toBe(second.promptFingerprint);
    expect(JSON.stringify(first)).not.toContain("same prompt");
  });

  it("forwards only the trusted correlation headers", () => {
    const headers = correlationHeaders({
      requestId: "server-request-1",
      promptFingerprint: "a".repeat(64),
    });

    expect(headers).toEqual({
      "x-9router-request-id": "server-request-1",
      "x-9router-prompt-fingerprint": "a".repeat(64),
    });
    expect(JSON.stringify(headers)).not.toContain("prompt text");
  });

  it("rejects malformed correlation values before forwarding", () => {
    expect(correlationHeaders({ requestId: "prompt text", promptFingerprint: "not-a-digest" })).toEqual({});
  });
});
