import { describe, it, expect } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("generic fallback behavior", () => {
  it("falls back and applies normal cooldown for an unmatched queue error", () => {
    expect(checkFallbackError(429, "execution queue is full", 2)).toEqual({ shouldFallback: true, cooldownMs: 8000, newBackoffLevel: 3 });
  });

  it("continues through combo members after a transient provider failure", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { model: "maintained-combo" },
      models: ["provider/first", "provider/second"],
      handleSingleModel: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: "temporary upstream failure" } }), { status: 503, headers: { "content-type": "application/json" } });
      },
      log: { info() {}, warn() {} },
    });
    expect(result.status).toBe(503);
    expect(calls).toBe(2);
  });
});
