import test from "node:test";
import assert from "node:assert/strict";
import { buildCgwResponseRequest, extractResponseText, mapReasoningEffort, readBearerToken, resolveBearer, runCgwTurn } from "../cgwResponses.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const config = {
  cgw: { baseUrl: "http://127.0.0.1:17841/v1", bearerFile: null },
  limits: { timeoutMs: 1000, maxOutputBytes: 256 },
};

test("builds a direct CGW Responses request with the requested model and effort", () => {
  const request = buildCgwResponseRequest({
    ...config.cgw,
    bearer: "cgw-token",
    model: "chatgpt-web/gpt-6-sol",
    prompt: "Reply with CGW_OK only.",
    reasoningEffort: "high",
  });
  assert.equal(request.url.toString(), "http://127.0.0.1:17841/v1/responses");
  assert.equal(request.init.headers.authorization, "Bearer cgw-token");
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, "chatgpt-web/gpt-6-sol");
  assert.equal(body.input[0].role, "user");
  assert.deepEqual(body.input[0].content, [{ type: "input_text", text: "Reply with CGW_OK only." }]);
  assert.match(body.input[0].id, /^msg_[A-Za-z0-9-]+$/);
  assert.match(body.input[0].internal_chat_message_metadata_passthrough.turn_id, /^turn_[A-Za-z0-9-]+$/);
  assert.match(body.client_metadata["x-codex-turn-metadata"], /"request_kind":"turn"/);
  assert.equal(body.store, false);
  assert.equal(body.stream, false);
  assert.deepEqual(body.reasoning, { effort: "high" });
});

test("maps public low effort to CGW instant effort", () => {
  assert.equal(mapReasoningEffort("low"), "instant");
  const request = buildCgwResponseRequest({
    ...config.cgw,
    bearer: "cgw-token",
    model: "chatgpt-web/gpt-6-sol",
    prompt: "Reply with CGW_OK only.",
    reasoningEffort: "low",
  });
  assert.deepEqual(JSON.parse(request.init.body).reasoning, { effort: "instant" });
});

test("extracts assistant text from Responses output", () => {
  assert.equal(extractResponseText({ output_text: "direct" }), "direct");
  assert.equal(extractResponseText({ output: [{ type: "message", content: [{ type: "output_text", text: "nested" }] }] }), "nested");
  assert.equal(extractResponseText({ output: [] }), null);
  assert.equal(extractResponseText({ output: [
    { type: "message", content: [{ type: "output_text", text: "commentary" }] },
    { type: "message", content: [{ type: "output_text", text: "final" }] },
  ] }), "final");
});

test("reads a bearer from a local env file without exposing it in the request contract", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cgw-bearer-"));
  const filePath = path.join(directory, "cgw.env");
  try {
    await writeFile(filePath, "CGW_SHIM_CGW_BEARER=local-token\n", "utf8");
    assert.equal(readBearerToken(filePath), "local-token");
    assert.equal(resolveBearer({ cgw: { bearerFile: filePath } }, {}), "local-token");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runs real CGW inference through Responses without invoking native Codex", async () => {
  let call;
  const result = await runCgwTurn({
    config,
    model: "chatgpt-web/gpt-5.6-sol",
    prompt: "Reply with CGW_OK only.",
    signal: undefined,
    bearer: "test-bearer",
    fetchImpl: async (url, init) => {
      call = { url: String(url), init };
      return new Response(JSON.stringify({ id: "resp_1", model: "chatgpt-web/gpt-5.6-sol", output_text: "CGW_OK" }), { status: 200 });
    },
  });
  assert.equal(result.text, "CGW_OK");
  assert.equal(call.url, "http://127.0.0.1:17841/v1/responses");
  assert.equal(call.init.headers.authorization, "Bearer test-bearer");
  const body = JSON.parse(call.init.body);
  assert.equal(body.model, "chatgpt-web/gpt-5.6-sol");
  assert.equal(body.input[0].internal_chat_message_metadata_passthrough.turn_id.length > 0, true);
  assert.match(body.client_metadata["x-codex-turn-metadata"], /"turn_id"/);
});

test("rejects a CGW response whose model does not match the requested browser model", async () => {
  await assert.rejects(() => runCgwTurn({
    config,
    model: "chatgpt-web/gpt-5.6-sol",
    prompt: "Reply with CGW_OK only.",
    bearer: "test-bearer",
    fetchImpl: async () => new Response(JSON.stringify({ model: "chatgpt-web/gpt-6-sol", output_text: "wrong" }), { status: 200 }),
  }), /model mismatch/);
});

test("rejects a successful CGW response without a model identity", async () => {
  await assert.rejects(() => runCgwTurn({
    config,
    model: "chatgpt-web/gpt-5.6-sol",
    prompt: "Reply with CGW_OK only.",
    bearer: "test-bearer",
    fetchImpl: async () => new Response(JSON.stringify({ output_text: "CGW_OK" }), { status: 200 }),
  }), /model mismatch/);
});

test("bounds the CGW response body before parsing it", async () => {
  await assert.rejects(() => runCgwTurn({
    config,
    model: "chatgpt-web/gpt-5.6-sol",
    prompt: "Reply with CGW_OK only.",
    bearer: "test-bearer",
    fetchImpl: async () => new Response(JSON.stringify({
      model: "chatgpt-web/gpt-5.6-sol",
      output_text: "x".repeat(500),
    }), { status: 200 }),
  }), /response body too large/);
});
