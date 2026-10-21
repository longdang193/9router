import test from "node:test";
import assert from "node:assert/strict";
import { validateChatRequest, parseBearerToken, readJsonBody } from "../http.js";

test("accepts one plain user message", () => {
  const result = validateChatRequest({
    model: "gpt-test",
    messages: [{ role: "user", content: "hello" }],
  }, { "gpt-test": "chatgpt-web/gpt-test" });
  assert.deepEqual(result, { model: "chatgpt-web/gpt-test", prompt: "hello" });
});

test("flattens interactive multi-message text into one CGW prompt", () => {
  const result = validateChatRequest({
    model: "gpt-test",
    messages: [
      { role: "system", content: "Follow the review contract." },
      { role: "user", content: "Reply with CGW_LIVE_PROBE_OK." },
    ],
  }, { "gpt-test": "chatgpt-web/gpt-test" });
  assert.equal(result.prompt, "[system]\nFollow the review contract.\n\n[user]\nReply with CGW_LIVE_PROBE_OK.");
});

test("flattens text-only content blocks from interactive Codex messages", () => {
  const result = validateChatRequest({
    model: "gpt-test",
    messages: [{
      role: "user",
      content: [
        { type: "input_text", text: "Reply with " },
        { type: "text", text: "CGW_LIVE_PROBE_OK." },
      ],
    }],
  }, { "gpt-test": "chatgpt-web/gpt-test" });
  assert.equal(result.prompt, "Reply with CGW_LIVE_PROBE_OK.");
});

test("accepts only low, medium, and high reasoning effort values", () => {
  for (const effort of ["low", "medium", "high"]) {
    const result = validateChatRequest({
      model: "gpt-test",
      reasoning_effort: effort,
      messages: [{ role: "user", content: "hello" }],
    }, { "gpt-test": "chatgpt-web/gpt-test" });
    assert.equal(result.reasoningEffort, effort);
  }
  assert.throws(() => validateChatRequest({
    model: "gpt-test",
    reasoning_effort: "normal",
    messages: [{ role: "user", content: "hello" }],
  }, { "gpt-test": "chatgpt-web/gpt-test" }), /reasoning_effort/);
});

test("ignores client tool metadata for text-only CGW reviews", () => {
  const result = validateChatRequest({
    model: "gpt-test",
    tools: [{ type: "function", function: { name: "read_github" } }],
    tool_choice: "auto",
    messages: [{ role: "user", content: "Review the GitHub URL." }],
  }, { "gpt-test": "chatgpt-web/gpt-test" });
  assert.deepEqual(result, {
    model: "chatgpt-web/gpt-test",
    prompt: "Review the GitHub URL.",
    toolsIgnored: true,
  });
});

test("rejects unsupported roles and multimodal content", () => {
  assert.throws(() => validateChatRequest({ model: "gpt-test", messages: [{ role: "unknown", content: "x" }] }, { "gpt-test": "chatgpt-web/gpt-test" }), /text message roles/);
  assert.throws(() => validateChatRequest({ model: "gpt-test", messages: [{ role: "user", content: [{ type: "image_url" }] }] }, { "gpt-test": "chatgpt-web/gpt-test" }), /text/);
});

test("parses bearer authentication without accepting malformed values", () => {
  assert.equal(parseBearerToken("Bearer secret"), "secret");
  assert.equal(parseBearerToken("Basic secret"), null);
  assert.equal(parseBearerToken("Bearer"), null);
});

test("reads bounded JSON bodies", async () => {
  const request = new Request("http://127.0.0.1", {
    method: "POST",
    body: JSON.stringify({ hello: "world" }),
  });
  assert.deepEqual(await readJsonBody(request, 1024), { hello: "world" });
  await assert.rejects(() => readJsonBody(new Request("http://127.0.0.1", {
    method: "POST",
    body: "x".repeat(20),
  }), 5), /body too large/);
});
