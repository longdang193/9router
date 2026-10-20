import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

async function runTransform(input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "codex",
      null,
      null,
      "gpt-5.5",
    ),
  );
  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

async function runResponsesTransformer(input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const output = stream.pipeThrough(createResponsesApiTransformStream());
  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function responseErrorStream() {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode([
        "event: error",
        `data: ${JSON.stringify({
          type: "error",
          error: {
            type: "internal_error",
            message: "response protection is unavailable",
          },
        })}`,
        "",
        "",
      ].join("\n")));
      controller.close();
    },
  });
}

describe("OpenAI Responses upstream errors", () => {
  it("preserves error event and diagnostic payload from HTTP 200 SSE", async () => {
    const output = await runTransform([
      "event: error",
      `data: ${JSON.stringify({
        type: "error",
        error: {
          type: "internal_error",
          message: "response protection is unavailable",
        },
      })}`,
      "",
      "",
    ].join("\n"));

    expect(output).toContain("event: error");
    expect(output).toContain('"message":"response protection is unavailable"');
    expect(output).not.toContain("event: response.failed");
    expect(output).not.toContain("[Empty streaming response]");
  });

  it("does not convert upstream error SSE into completed empty Responses output", async () => {
    const output = await runResponsesTransformer([
      `data: ${JSON.stringify({
        type: "error",
        error: {
          type: "internal_error",
          message: "response protection is unavailable",
        },
      })}`,
      "",
      "",
    ].join("\n"));

    expect(output).toContain('"message":"response protection is unavailable"');
    expect(output).not.toContain("event: response.completed");
  });

  it("returns failed JSON with upstream error details for non-streaming clients", async () => {
    const output = await convertResponsesStreamToJson(responseErrorStream());

    expect(output.status).toBe("failed");
    expect(output.error).toEqual({
      type: "internal_error",
      message: "response protection is unavailable",
    });
  });
});
