import { describe, it, expect } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("CGW queue saturation", () => {
  it("does not trigger account fallback or quota backoff", () => {
    expect(checkFallbackError(429, "CGW execution queue is full", 2)).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
      newBackoffLevel: 2,
    });
  });

  it("stops combo fallback on the local queue boundary", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { model: "combo-web-high" },
      models: ["cgw/gpt-6.1-sol", "cgw/gpt-5.6-sol"],
      handleSingleModel: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: "CGW execution queue is full" } }), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      },
      log: { info() {}, warn() {} },
    });

    expect(result.status).toBe(429);
    expect(calls).toBe(1);
  });
});
