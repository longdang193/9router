// Issue #3010 — Dashboard "Test" button fails for reasoning models because of a
// tiny max_tokens probe. pingModelByKind must use a sane budget (1024) and treat a
// reasoning-only (length-limited) response as a successful connection.
//
// The route module pulls in Next.js-only deps (@/lib/localDb, etc.) that don't
// resolve under raw vitest, so we mock them and exercise the exported function.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the heavy Next.js-dependent imports BEFORE importing ping.js.
vi.mock("@/lib/localDb", () => ({ getApiKeys: vi.fn(async () => [{ key: "test-key", isActive: true }]) }));
vi.mock("@/shared/constants/config", () => ({ UPDATER_CONFIG: { appPort: 20127 } }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn(async () => "cli-token") }));

const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");

describe("pingModelByKind reasoning models (#3010)", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(obj) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(obj),
      json: async () => obj,
    };
  }

  it("uses a 1024-token budget for the chat completions probe", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "Hi there!" } }] }));

    await pingModelByKind("cline-pass/kimi-k3", "llm", "http://127.0.0.1:20127");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(1024);
  });

  it("treats a reasoning-only (length-limited) response as ok:true", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [
          {
            finish_reason: "length",
            message: { content: "", reasoning: "The user said hi — a simple greeting..." },
          },
        ],
      })
    );

    const result = await pingModelByKind("cline-pass/kimi-k3", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(true);
    expect(result.note).toMatch(/reasoning-only/);
  });

  it("still fails when there are no choices and no reasoning", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [] }));
    const result = await pingModelByKind("some/model", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no completion choices/);
  });

  it("passes a normal answer with the larger budget", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "Hello!" } }] }));
    const result = await pingModelByKind("openai/gpt-4o", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(true);
  });

  it("checks CGW models with a real inference response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      model: "cgw/gpt-5.6-sol",
      choices: [{ message: { content: "CGW probe ok" } }],
    }));

    const result = await pingModelByKind("cgw/gpt-5.6-sol", "llm", "http://127.0.0.1:20127");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:20127/api/v1/chat/completions");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: "cgw/gpt-5.6-sol",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("fails a CGW inference check when the provider returns a different model", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      model: "cgw/gpt-5.6-sol",
      choices: [{ message: { content: "wrong model" } }],
    }));

    const result = await pingModelByKind("cgw/gpt-6.1-sol", "llm", "http://127.0.0.1:20127");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expected cgw\/gpt-6\.1-sol/);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:20127/api/v1/chat/completions");
  });

  it("accepts the unprefixed public model returned by 9Router's CGW adapter", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      model: "gpt-5.6-sol",
      choices: [{ message: { content: "CGW probe ok" } }],
    }));

    const result = await pingModelByKind("cgw/gpt-5.6-sol", "llm", "http://127.0.0.1:20127");

    expect(result.ok).toBe(true);
  });
});
