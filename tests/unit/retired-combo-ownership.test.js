import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RetiredModelError } from "../../open-sse/config/retiredModels.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

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
  it.each(["combo-web-high", "combo-web-medium", "cgw/gpt-5.6-sol", "chatgpt-web/gpt-5.6-sol", "cg/gpt-5.6-sol"])("rejects retired model %s on combo creation", async (model) => {
    await expect(combos.createCombo({ name: "maintained-combo", models: [model] })).rejects.toMatchObject({ code: "RETIRED_MODEL", status: 410 });
  });

  it("fails closed when a stale persisted combo row is read", async () => {
    const adapter = await db.getAdapter();
    adapter.run("INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)", ["stale", "legacy-combo", "fallback", JSON.stringify(["cgw/gpt-5.6-sol"]), new Date().toISOString(), new Date().toISOString()]);
    await expect(combos.getComboById("stale")).resolves.toMatchObject({
      id: "stale",
      validity: "retired",
      invalidModels: ["cgw/gpt-5.6-sol"],
    });
    await expect(combos.getCombos()).resolves.toEqual([
      expect.objectContaining({ id: "stale", validity: "retired" }),
    ]);
  });

  it("preserves malformed persisted JSON instead of treating it as an empty combo", async () => {
    const adapter = await db.getAdapter();
    adapter.run("INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)", ["malformed", "broken-combo", "fallback", "not-json", new Date().toISOString(), new Date().toISOString()]);
    await expect(combos.getComboById("malformed")).resolves.toMatchObject({
      id: "malformed",
      validity: "malformed",
      models: [],
      parseError: expect.any(String),
    });
  });

  it("allows an explicit PUT repair of a stale row", async () => {
    const adapter = await db.getAdapter();
    adapter.run("INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)", ["repair", "repairable", "fallback", JSON.stringify(["cgw/gpt-5.6-sol"]), new Date().toISOString(), new Date().toISOString()]);
    await expect(combos.updateCombo("repair", { models: ["openai/gpt-5.6"] })).resolves.toMatchObject({
      id: "repair",
      validity: "valid",
      models: ["openai/gpt-5.6"],
    });
  });

  it("rejects a retired combo lookup before selecting a database row", async () => {
    await expect(combos.getComboByName("combo-web-high")).rejects.toMatchObject({ code: "RETIRED_MODEL", status: 410 });
  });

  it("returns the retired-model contract from the combo collection boundary", async () => {
    const { POST } = await import("../../src/app/api/combos/route.js");
    const response = await POST(new Request("http://localhost/api/combos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "retired-combo", models: ["combo-web-high"] }),
    }));
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RETIRED_MODEL" } });
  });

  it("lists and deletes a stale row through the combo item boundary", async () => {
    const adapter = await db.getAdapter();
    adapter.run("INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)", ["boundary-stale", "legacy-boundary", "fallback", JSON.stringify(["cgw/gpt-5.6-sol"]), new Date().toISOString(), new Date().toISOString()]);
    const { GET, DELETE } = await import("../../src/app/api/combos/[id]/route.js");
    const routeContext = { params: { id: "boundary-stale" } };

    const listed = await GET(new Request("http://localhost/api/combos/boundary-stale"), routeContext);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ id: "boundary-stale", validity: "retired" });

    const deleted = await DELETE(new Request("http://localhost/api/combos/boundary-stale", { method: "DELETE" }), routeContext);
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ success: true });
  });

  it("hides retired and malformed rows from the executable model catalog", async () => {
    const adapter = await db.getAdapter();
    const now = new Date().toISOString();
    adapter.run("INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)", ["catalog-stale", "legacy-catalog", "fallback", JSON.stringify(["cg/gpt-5.6-sol"]), now, now]);
    adapter.run("INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)", ["catalog-malformed", "broken-catalog", "fallback", "not-json", now, now]);
    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
    const models = await buildModelsList(["llm"]);
    expect(models.some((model) => ["legacy-catalog", "broken-catalog"].includes(model.id))).toBe(false);
  });

  it("rejects retired targets before persisting model aliases", async () => {
    const { PUT } = await import("../../src/app/api/models/alias/route.js");
    const response = await PUT(new Request("http://localhost/api/models/alias", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "retired-alias", model: "cg/gpt-5.6-sol" }),
    }));
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RETIRED_MODEL" } });
    await expect((await import("@/lib/db/repos/aliasRepo.js")).getModelAliases()).resolves.not.toHaveProperty("retired-alias");
  });

  it("returns the retired-model contract from image generation", async () => {
    const { updateSettings } = await import("@/lib/localDb");
    await updateSettings({ requireApiKey: false });
    const { POST } = await import("../../src/app/api/v1/images/generations/route.js");
    const response = await POST(new Request("http://localhost/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "cg/gpt-image-2", prompt: "test" }),
    }));
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RETIRED_MODEL" } });
  });

  it("does not fall through to another model after a retired-model exception", async () => {
    const attempted = [];
    await expect(handleComboChat({
      body: {},
      models: ["cgw/gpt-5.6-sol", "openai/gpt-5.6"],
      handleSingleModel: async (_body, model) => {
        attempted.push(model);
        if (model.startsWith("cgw/")) throw new RetiredModelError(model);
        return new Response("ok", { status: 200 });
      },
      log: { info() {}, warn() {} },
    })).rejects.toMatchObject({ code: "RETIRED_MODEL", status: 410 });
    expect(attempted).toEqual(["cgw/gpt-5.6-sol"]);
  });
});
