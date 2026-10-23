import { describe, expect, it } from "vitest";

import { getImageAdapter, isImageProvider } from "../../open-sse/handlers/imageProviders/index.js";
import { parseModel } from "../../open-sse/services/model.js";

describe("retired ChatGPT Web image paths", () => {
  it("rejects the cg image alias after provider normalization", () => {
    expect(() => parseModel("cg/gpt-image-2")).toThrowError(expect.objectContaining({
      code: "RETIRED_MODEL",
      status: 410,
    }));
  });

  it("does not expose the retired ChatGPT Web image adapter", () => {
    expect(isImageProvider("chatgpt-web")).toBe(false);
    expect(getImageAdapter("chatgpt-web")).toBeNull();
  });

  it("keeps the maintained Codex image adapter available", () => {
    expect(isImageProvider("codex")).toBe(true);
    expect(getImageAdapter("codex")).not.toBeNull();
  });
});
