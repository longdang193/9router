import { describe, expect, it } from "vitest";

import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

async function runTransform(input) {
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

describe("Responses API completion events", () => {
  it("includes an output array in response.completed", async () => {
    const output = await runTransform([
      "data: " + JSON.stringify({
        id: "chatcmpl_test",
        choices: [{
          index: 0,
          delta: { content: "done" },
          finish_reason: "stop",
        }],
      }),
      "",
      "",
    ].join("\n"));

    const completed = output
      .split("\n\n")
      .find((event) => event.startsWith("event: response.completed"));
    const payload = JSON.parse(completed.split("data: ")[1]);

    expect(payload.response.output).toEqual([{
      id: "msg_resp_chatcmpl_test_0",
      type: "message",
      content: [{ type: "output_text", annotations: [], logprobs: [], text: "done" }],
      role: "assistant",
    }]);
  });
});
