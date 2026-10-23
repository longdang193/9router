import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-routing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const { createProviderNode } = await import("@/models/index.js");
  const { setModelAlias, updateSettings } = await import("@/lib/localDb");
  const { getModelInfo } = await import("@/sse/services/model.js");
  const { handleChat } = await import("@/sse/handlers/chat.js");
  return { createProviderNode, setModelAlias, updateSettings, getModelInfo, handleChat, cleanup() { global._dbAdapter?.instance?.close?.(); if (global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false }; fs.rmSync(tempDir, { recursive: true, force: true }); } };
}

describe("model routing", () => {
  let cleanup = () => {};
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { vi.resetModules(); vi.clearAllMocks(); cleanup(); cleanup = () => {}; if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir; });

  it("keeps built-in provider aliases ahead of compatible node prefixes", async () => {
    const ctx = await setupDb(); cleanup = ctx.cleanup;
    await ctx.createProviderNode({ id: "openai-compatible-chat-test", type: "openai-compatible", name: "Compatible CF Collision", prefix: "cf", apiType: "chat", baseUrl: "https://compatible.test/v1" });
    await expect(ctx.getModelInfo("cf/@cf/black-forest-labs/flux-2-klein-9b")).resolves.toEqual({ provider: "cloudflare-ai", model: "@cf/black-forest-labs/flux-2-klein-9b" });
  });

  it("still routes non-reserved compatible node prefixes", async () => {
    const ctx = await setupDb(); cleanup = ctx.cleanup;
    await ctx.createProviderNode({ id: "openai-compatible-chat-test", type: "openai-compatible", name: "Compatible OCT", prefix: "oct", apiType: "chat", baseUrl: "https://compatible.test/v1" });
    await expect(ctx.getModelInfo("oct/gpt-image-1")).resolves.toEqual({ provider: "openai-compatible-chat-test", model: "gpt-image-1" });
  });

  it.each(["combo-web-high", "combo-web-medium", "cgw/gpt-5.6-sol", "chatgpt-web/gpt-5.6-sol"])("rejects retired model %s before provider lookup", async (model) => {
    const ctx = await setupDb(); cleanup = ctx.cleanup;
    await expect(ctx.getModelInfo(model)).rejects.toMatchObject({ code: "RETIRED_MODEL", status: 410 });
  });

  it.each([
    ["cgw-alias", "cgw/gpt-5.6-sol"],
    ["chatgpt-web-alias", "chatgpt-web/gpt-5.6-sol"],
    ["retired-combo-alias", "combo-web-high"],
  ])("rejects alias %s after resolving retired target %s", async (alias, target) => {
    const ctx = await setupDb(); cleanup = ctx.cleanup;
    await ctx.setModelAlias(alias, target);
    await expect(ctx.getModelInfo(alias)).rejects.toMatchObject({ code: "RETIRED_MODEL", status: 410 });
  });

  it("rejects alias cycles instead of recursing or falling through to a provider", async () => {
    const ctx = await setupDb(); cleanup = ctx.cleanup;
    await ctx.setModelAlias("cycle-a", "cycle-b");
    await ctx.setModelAlias("cycle-b", "cycle-a");
    await expect(ctx.getModelInfo("cycle-a")).rejects.toMatchObject({ code: "MODEL_ALIAS_CYCLE" });
  });

  it("returns the retired-model contract at the chat boundary", async () => {
    const ctx = await setupDb(); cleanup = ctx.cleanup;
    await ctx.updateSettings({ requireApiKey: false });
    const response = await ctx.handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "cgw/gpt-5.6-sol", messages: [{ role: "user", content: "test" }] }),
    }));
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RETIRED_MODEL" } });
  });

  it.each([
    ["/v1/chat/completions", () => import("../../src/app/api/v1/chat/completions/route.js")],
    ["/v1/responses", () => import("../../src/app/api/v1/responses/route.js")],
    ["/v1/responses/compact", () => import("../../src/app/api/v1/responses/compact/route.js")],
    ["/v1/api/chat", () => import("../../src/app/api/v1/api/chat/route.js")],
  ])("preserves the retired-model contract at %s", async (endpoint, loadRoute) => {
    const ctx = await setupDb(); cleanup = ctx.cleanup;
    await ctx.updateSettings({ requireApiKey: false });
    const { POST } = await loadRoute();
    const response = await POST(new Request(`http://localhost${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "cgw/gpt-5.6-sol", messages: [{ role: "user", content: "test" }] }),
    }));
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RETIRED_MODEL" } });
  });
});
