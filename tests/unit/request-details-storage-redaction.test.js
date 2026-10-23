import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const originalRequestLogs = process.env.ENABLE_REQUEST_LOGS;
const originalBatchSize = process.env.OBSERVABILITY_BATCH_SIZE;
let tempDir;
let db;
let adapter;
const testDetailId = `redaction-${process.pid}`;

beforeAll(async () => {
  const sharedState = global._dbAdapter;
  try { sharedState?.instance?.close?.(); } catch {}
  if (sharedState) {
    sharedState.instance = null;
    sharedState.initPromise = null;
    sharedState.logged = false;
  }
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-details-redaction-"));
  process.env.DATA_DIR = tempDir;
  process.env.ENABLE_REQUEST_LOGS = "true";
  process.env.OBSERVABILITY_BATCH_SIZE = "1";
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
});

afterAll(() => {
  try { adapter?.run?.("DELETE FROM requestDetails WHERE id = ?", [testDetailId]); } catch {}
  try { adapter?.close?.(); } catch {}
  if (global._dbAdapter?.instance === adapter) {
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalRequestLogs === undefined) delete process.env.ENABLE_REQUEST_LOGS;
  else process.env.ENABLE_REQUEST_LOGS = originalRequestLogs;
  if (originalBatchSize === undefined) delete process.env.OBSERVABILITY_BATCH_SIZE;
  else process.env.OBSERVABILITY_BATCH_SIZE = originalBatchSize;
});

describe("request detail storage redaction", () => {
  it("does not persist request or provider payload values", async () => {
    await db.saveRequestDetail({
      id: testDetailId,
      provider: "openai",
      model: "gpt-test",
      status: "success",
      request: { messages: [{ role: "user", content: "user-secret" }] },
      providerRequest: {
        input: "provider-secret",
        client_metadata: { session_id: "session-safe" },
      },
      providerResponse: { output: "response-secret" },
      response: { content: "answer-secret" },
    });
    let stored = null;
    for (let attempt = 0; attempt < 20 && !stored; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      stored = await db.getRequestDetailById(testDetailId);
    }

    expect(stored.request).toEqual({ redacted: true });
    expect(stored.providerRequest).toEqual({ redacted: true });
    expect(stored.clientMetadata).toEqual({ session_id: "session-safe" });
    expect(stored.providerResponse).toEqual({ redacted: true });
    expect(stored.response).toEqual({ redacted: true });
    expect(JSON.stringify(stored)).not.toMatch(/secret/);
  });

  it("persists safe request correlation without persisting prompt text", async () => {
    const detailId = `${testDetailId}-correlation`;
    const promptFingerprint = "b".repeat(64);
    await db.saveRequestDetail({
      id: detailId,
      provider: "codex",
      model: "maintained-combo",
      status: "error",
      correlation: { requestId: "server-request-1", promptFingerprint },
      request: { messages: [{ role: "user", content: "private prompt" }] },
    });
    let stored = null;
    for (let attempt = 0; attempt < 20 && !stored; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      stored = await db.getRequestDetailById(detailId);
    }

    expect(stored.correlation).toEqual({ requestId: "server-request-1", promptFingerprint });
    expect(JSON.stringify(stored)).not.toContain("private prompt");
  });

  it("persists the request detail correlation key on usage rows", async () => {
    const timestamp = "2026-10-11T10:00:00.000Z";
    await db.saveRequestUsage({
      provider: "codex",
      model: "gpt-test",
      timestamp,
      requestDetailId: testDetailId,
      tokens: { prompt_tokens: 10, completion_tokens: 2 },
    });

    const usage = adapter.get("SELECT meta FROM usageHistory WHERE timestamp = ?", [timestamp]);
    expect(JSON.parse(usage.meta)).toEqual({ request_detail_id: testDetailId });
  });

  it("does not deduplicate distinct correlated requests at the same timestamp", async () => {
    const timestamp = "2026-10-11T10:00:01.000Z";
    await Promise.all([
      db.saveRequestUsage({ provider: "codex", model: "gpt-test", timestamp, requestDetailId: "request-A", tokens: { prompt_tokens: 10, completion_tokens: 2 } }),
      db.saveRequestUsage({ provider: "codex", model: "gpt-test", timestamp, requestDetailId: "request-B", tokens: { prompt_tokens: 10, completion_tokens: 2 } }),
    ]);

    const rows = adapter.all("SELECT meta FROM usageHistory WHERE timestamp = ? ORDER BY id", [timestamp]);
    expect(rows.map((row) => JSON.parse(row.meta).request_detail_id)).toEqual(["request-A", "request-B"]);
  });
});
