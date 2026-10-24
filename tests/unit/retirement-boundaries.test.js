import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-retirement-boundaries-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/driver.js");
  await db.getAdapter();
});

afterEach(() => {
  global._dbAdapter?.instance?.close?.();
  if (global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("retirement model boundaries", () => {
  it("rejects retired custom models without persisting them", async () => {
    const { POST } = await import("../../src/app/api/models/custom/route.js");
    const response = await POST(new Request("http://localhost/api/models/custom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerAlias: "cg", id: "gpt-5.6-sol", type: "llm" }),
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RETIRED_MODEL" } });
    await expect((await import("@/lib/db/repos/aliasRepo.js")).getCustomModels()).resolves.toEqual([]);
  });

  it("keeps stale custom rows readable and removable through the admin boundary", async () => {
    const adapter = await db.getAdapter();
    adapter.run(
      "INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)",
      ["customModels", "cg|gpt-5.6-sol|llm", JSON.stringify({ providerAlias: "cg", id: "gpt-5.6-sol", type: "llm", name: "legacy" })],
    );
    const { GET, DELETE } = await import("../../src/app/api/models/custom/route.js");

    const listed = await GET(new Request("http://localhost/api/models/custom"));
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({
      models: [expect.objectContaining({ providerAlias: "cg", id: "gpt-5.6-sol", name: "legacy" })],
    });

    const deleted = await DELETE(new Request("http://localhost/api/models/custom?providerAlias=cg&id=gpt-5.6-sol&type=llm", { method: "DELETE" }));
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ success: true });
  });

  it("does not advertise retired custom rows in the dashboard model catalog", async () => {
    const adapter = await db.getAdapter();
    adapter.run(
      "INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)",
      ["customModels", "chatgpt-web|gpt-5.6-sol|llm", JSON.stringify({ providerAlias: "chatgpt-web", id: "gpt-5.6-sol", type: "llm", name: "legacy" })],
    );
    const { GET } = await import("../../src/app/api/models/route.js");
    const response = await GET(new Request("http://localhost/api/models"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.models.some((model) => model.fullModel === "chatgpt-web/gpt-5.6-sol")).toBe(false);
  });

  it("returns the retired-model contract from single-model lookup", async () => {
    const { GET } = await import("../../src/app/api/v1/models/[...model]/route.js");
    const response = await GET(
      new Request("http://localhost/v1/models/cg/gpt-5.6-sol"),
      { params: { model: ["cg", "gpt-5.6-sol"] } },
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RETIRED_MODEL" } });
  });
});
