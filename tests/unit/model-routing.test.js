import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-routing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createProviderNode, createProviderConnection } = await import("@/models/index.js");
  const { getModelInfo } = await import("@/sse/services/model.js");

  return {
    createProviderNode,
    createProviderConnection,
    getModelInfo,
    cleanup() {
      global._dbAdapter?.instance?.close?.();
      if (global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("model routing", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("keeps built-in provider aliases ahead of compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible CF Collision",
      prefix: "cf",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("cf/@cf/black-forest-labs/flux-2-klein-9b"))
      .resolves.toEqual({
        provider: "cloudflare-ai",
        model: "@cf/black-forest-labs/flux-2-klein-9b",
      });
  });

  it("still routes non-reserved compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible OCT",
      prefix: "oct",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("oct/gpt-image-1"))
      .resolves.toEqual({
        provider: "openai-compatible-chat-test",
        model: "gpt-image-1",
      });
  });

  it("prefers the uniquely active compatible node when a prefix has a stale duplicate", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-stale-cgw",
      type: "openai-compatible",
      name: "ChatGPT Web",
      prefix: "cgw",
      apiType: "chat",
      baseUrl: "http://127.0.0.1:20129/v1",
    });
    await ctx.createProviderNode({
      id: "openai-compatible-active-cgw",
      type: "openai-compatible",
      name: "CGW Codex Shim",
      prefix: "cgw",
      apiType: "chat",
      baseUrl: "http://127.0.0.1:20129/v1",
    });
    await ctx.createProviderConnection({
      id: "stale-cgw-connection",
      provider: "openai-compatible-stale-cgw",
      authType: "apikey",
      name: "CGW_SHIM_API_KEY",
      apiKey: "test-key",
      defaultModel: "gpt-5.6-sol",
      testStatus: "unavailable",
      isActive: true,
    });
    await ctx.createProviderConnection({
      id: "active-cgw-connection",
      provider: "openai-compatible-active-cgw",
      authType: "apikey",
      name: "CGW Codex Shim",
      apiKey: "test-key",
      defaultModel: "gpt-5.6-sol",
      testStatus: "active",
      isActive: true,
    });

    await expect(ctx.getModelInfo("cgw/gpt-5.6-sol")).resolves.toEqual({
      provider: "openai-compatible-active-cgw",
      model: "gpt-5.6-sol",
    });
  });

  it("fails closed when duplicate compatible prefixes have multiple active nodes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    for (const id of ["openai-compatible-cgw-a", "openai-compatible-cgw-b"]) {
      await ctx.createProviderNode({
        id,
        type: "openai-compatible",
        name: id,
        prefix: "cgw",
        apiType: "chat",
        baseUrl: "http://127.0.0.1:20129/v1",
      });
      await ctx.createProviderConnection({
        id: `${id}-connection`,
        provider: id,
        authType: "apikey",
        name: id,
        apiKey: "test-key",
        defaultModel: "gpt-5.6-sol",
        testStatus: "active",
        isActive: true,
      });
    }

    await expect(ctx.getModelInfo("cgw/gpt-5.6-sol"))
      .rejects.toThrow(/Ambiguous compatible provider prefix 'cgw'/);
  });
});
