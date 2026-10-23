import { describe, expect, it } from "vitest";
import { serializeCodexConfig } from "@/lib/codexConfigSerialization.js";

describe("Codex config TOML serialization", () => {
  it("quotes the numeric-leading 9router provider table", () => {
    const output = serializeCodexConfig({
      model_providers: {
        "9router": {
          name: "9Router",
          base_url: "http://127.0.0.1:20129/v1",
        },
      },
    });

    expect(output).toContain('[model_providers."9router"]');
    expect(output).not.toContain("[model_providers.9router]");
  });

  it("quotes 9router in nested wire-api tables without changing other tables", () => {
    const output = serializeCodexConfig({
      model_providers: {
        "9router": {
          wire_api_by_model: {
            "provider/gpt-6.1-sol": { wire_api: "responses" },
          },
        },
        openai: { name: "OpenAI" },
      },
    });

    expect(output).toContain('[model_providers."9router".wire_api_by_model."provider/gpt-6.1-sol"]');
    expect(output).toContain("[model_providers.openai]");
    expect(output).not.toContain("[model_providers.9router");
  });
});
