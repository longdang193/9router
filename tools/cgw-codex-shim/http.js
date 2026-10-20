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

function parseReasoningEffort(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !REASONING_EFFORTS.has(value)) {
    throw new Error("reasoning_effort must be one of: low, medium, high");
  }
  return value;
}

function plainTextContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("message content must be plain text");
  const parts = content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") return part.text;
    throw new Error("message content must be plain text");
  });
  return parts.join("");
}

export function validateChatRequest(body, modelAliases, { compatibilityMode = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
  if (!compatibilityMode && (body.tools !== undefined || body.tool_choice !== undefined)) throw new Error("tools are not supported");
  if (body.response_format !== undefined || body.modalities !== undefined || body.audio !== undefined) throw new Error("multimodal and response-format options are not supported");
  if (typeof body.model !== "string" || !modelAliases[body.model]) throw new Error("unknown model alias");
  if (!Array.isArray(body.messages) || !body.messages.length) throw new Error("at least one message is supported");
  if (!compatibilityMode && body.messages.length !== 1) throw new Error("exactly one user message is supported");
  const messages = body.messages.map((message) => {
    if (!message || !["user", "system", "developer", "assistant", "tool"].includes(message.role)) {
      throw new Error(compatibilityMode ? "unsupported message role" : "only one user message is supported");
    }
    if (!compatibilityMode && message.role !== "user") throw new Error("only one user message is supported");
    const content = plainTextContent(message.content);
    if (!content.trim()) throw new Error("message content must be plain text");
    return { role: message.role, content };
  });
  const prompt = compatibilityMode
    ? messages.map(({ role, content }) => `[${role}]\n${content}`).join("\n\n")
    : messages[0].content;
  const result = { model: modelAliases[body.model], prompt };
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
