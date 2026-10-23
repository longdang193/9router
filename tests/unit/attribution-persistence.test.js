import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createRequestAttribution } from "../../open-sse/handlers/chatCore/attribution.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let adapter;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-attribution-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });
  const { getAdapter } = await import("../../src/lib/db/driver.js");
  adapter = await getAdapter();
});

afterAll(async () => {
  if (adapter?.close) adapter.close();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("request attribution persistence", () => {
  it("preserves LightRSI headers while assigning a router-owned record ID", () => {
    const attribution = createRequestAttribution({
      "x-lightrsi-request-id": "experiment-request-header",
      "x-lightrsi-provider-attempt-id": "experiment-request-header:attempt-1",
    });

    expect(attribution).toMatchObject({
      experimentRequestId: "experiment-request-header",
      providerAttemptId: "experiment-request-header:attempt-1",
    });
    expect(attribution.routerRecordId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("keeps one immutable router record ID in both authoritative tables", async () => {
    const attribution = {
      routerRecordId: "router-record-1",
      experimentRequestId: "experiment-request-1",
      providerAttemptId: "experiment-request-1:attempt-1",
    };
    const timestamp = "2026-10-11T18:00:00.000Z";

    await db.saveRequestUsage({
      ...attribution,
      timestamp,
      provider: "codex",
      model: "gpt-fixture",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });
    await db.saveRequestDetail({
      id: "detail-1",
      ...attribution,
      timestamp,
      provider: "codex",
      model: "gpt-fixture",
      status: "success",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      request: { headers: { "x-lightrsi-request-id": attribution.experimentRequestId } },
    });
    await new Promise((resolve) => setTimeout(resolve, 120));

    const usage = adapter.get(
      "SELECT routerRecordId, experimentRequestId, providerAttemptId FROM usageHistory WHERE routerRecordId = ?",
      [attribution.routerRecordId],
    );
    const detail = adapter.get(
      "SELECT routerRecordId, experimentRequestId, providerAttemptId FROM requestDetails WHERE routerRecordId = ?",
      [attribution.routerRecordId],
    );

    expect(usage).toEqual(attribution);
    expect(detail).toEqual(attribution);
    expect((await db.getRequestDetails({ pageSize: 10 })).details[0].routerRecordId).toBe(attribution.routerRecordId);
  });

  it("does not deduplicate distinct provider attempts with identical measurements", async () => {
    const base = {
      timestamp: "2026-10-11T18:01:00.000Z",
      provider: "codex",
      model: "gpt-fixture",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    };

    await db.saveRequestUsage({
      ...base,
      routerRecordId: "router-record-2",
      experimentRequestId: "experiment-request-1",
      providerAttemptId: "experiment-request-1:attempt-2",
    });
    await db.saveRequestUsage({
      ...base,
      routerRecordId: "router-record-3",
      experimentRequestId: "experiment-request-1",
      providerAttemptId: "experiment-request-1:attempt-3",
    });

    const rows = adapter.all(
      "SELECT routerRecordId FROM usageHistory WHERE timestamp = ? ORDER BY id",
      [base.timestamp],
    );
    expect(rows.map((row) => row.routerRecordId)).toEqual([
      "router-record-2",
      "router-record-3",
    ]);
  });
});
