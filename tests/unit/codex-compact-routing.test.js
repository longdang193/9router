import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

describe("CodexExecutor compact routing", () => {
  it("selects compact endpoint from current request without stale executor state", () => {
    const executor = new CodexExecutor();
    const credentials = {};

    expect(executor.buildUrl("gpt-5.6-sol", true, 0, credentials, { _compact: true })).toMatch(/\/compact$/);
    expect(executor.buildUrl("gpt-5.6-sol", true, 0, credentials, {})).not.toMatch(/\/compact$/);
    expect(executor.buildUrl("gpt-5.6-sol", true, 0, credentials, { _compact: true })).toMatch(/\/compact$/);
  });
});
