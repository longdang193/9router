import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let combos;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-retired-combo-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/driver.js");
  combos = await import("@/lib/db/repos/combosRepo.js");
  await db.getAdapter();
});

afterEach(() => {
  global._dbAdapter?.instance?.close?.();
  if (global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
});

describe("retired combo ownership", () => {
  it.each(["combo-web-high", "combo-web-medium", "cgw/gpt-5.6-sol", "chatgpt-web/gpt-5.6-sol"])("rejects retired model %s on combo creation", async (model) => {
    await expect(combos.createCombo({ name: "maintained-combo", models: [model] })).rejects.toMatchObject({ code: "RETIRED_MODEL", status: 410 });
  });

  it("fails closed when a stale persisted combo row is read", async () => {
    const adapter = await db.getAdapter();
    adapter.run("INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)", ["stale", "legacy-combo", "fallback", JSON.stringify(["cgw/gpt-5.6-sol"]), new Date().toISOString(), new Date().toISOString()]);
    await expect(combos.getComboById("stale")).rejects.toMatchObject({ code: "RETIRED_MODEL", status: 410 });
    await expect(combos.getCombos()).rejects.toMatchObject({ code: "RETIRED_MODEL", status: 410 });
  });

  it("rejects a retired combo lookup before selecting a database row", async () => {
    await expect(combos.getComboByName("combo-web-high")).rejects.toMatchObject({ code: "RETIRED_MODEL", status: 410 });
  });
});
