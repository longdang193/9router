export function parseBearerToken(header) {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export async function readJsonBody(request, maxBytes) {
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maxBytes) throw new Error("request body too large");
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

const REASONING_EFFORTS = new Set(["low", "medium", "high"]);
const TEXT_MESSAGE_ROLES = new Set(["system", "developer", "user", "assistant", "tool", "function"]);

function normalizeTextContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    throw new Error("message content must be plain text");
  }
  const text = content.map((part) => {
    if (!part || typeof part !== "object" || !["text", "input_text", "output_text"].includes(part.type) || typeof part.text !== "string") {
      throw new Error("message content must be plain text");
    }
    return part.text;
  }).join("").trim();
  if (!text) throw new Error("message content must be plain text");
  return text;
}

function parseReasoningEffort(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !REASONING_EFFORTS.has(value)) {
    throw new Error("reasoning_effort must be one of: low, medium, high");
  }
  return value;
}

export function validateChatRequest(body, modelAliases) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
  if (body.response_format !== undefined || body.modalities !== undefined || body.audio !== undefined) throw new Error("multimodal and response-format options are not supported");
  if (typeof body.model !== "string" || !modelAliases[body.model]) throw new Error("unknown model alias");
  if (!Array.isArray(body.messages) || body.messages.length === 0) throw new Error("at least one text message is required");
  const messages = body.messages.map((message) => {
    if (!message || !TEXT_MESSAGE_ROLES.has(message.role)) throw new Error("only text message roles are supported");
    return { role: message.role, content: normalizeTextContent(message.content) };
  });
  const prompt = messages.length === 1 && messages[0].role === "user"
    ? messages[0].content
    : messages.map(({ role, content }) => `[${role}]\n${content}`).join("\n\n");
  const result = { model: modelAliases[body.model], prompt };
  if (body.tools !== undefined || body.tool_choice !== undefined) result.toolsIgnored = true;
  if (body.reasoning_effort !== undefined) result.reasoningEffort = parseReasoningEffort(body.reasoning_effort);
  return result;
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function errorResponse(status, message, headers = {}) {
  return jsonResponse({ error: { message, type: "cgw_codex_shim_error" } }, status, headers);
}
