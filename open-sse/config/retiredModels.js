const RETIRED_MODEL_NAMES = new Set(["combo-web-high", "combo-web-medium"]);
const RETIRED_MODEL_PREFIXES = ["cgw/", "chatgpt-web/"];

export class RetiredModelError extends Error {
  constructor(value) {
    super("Model or combo is retired and unsupported: " + value);
    this.name = "RetiredModelError";
    this.code = "RETIRED_MODEL";
    this.status = 410;
  }
}

export function isRetiredModel(value) {
  if (typeof value !== "string") return false;
  return RETIRED_MODEL_NAMES.has(value) || RETIRED_MODEL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function assertSupportedModel(value) {
  if (isRetiredModel(value)) throw new RetiredModelError(value);
  return value;
}

export function assertSupportedCombo(combo) {
  if (!combo || typeof combo !== "object") return combo;
  assertSupportedModel(combo.name);
  for (const model of Array.isArray(combo.models) ? combo.models : []) assertSupportedModel(model);
  return combo;
}

export function isRetiredModelError(error) {
  return error?.code === "RETIRED_MODEL" && error?.status === 410;
}

export function retiredModelPayload(error) {
  return {
    error: {
      message: error?.message || "Model or combo is retired and unsupported",
      type: "invalid_request_error",
      code: "RETIRED_MODEL",
    },
  };
}

export function isRetiredModelName(value) {
  return RETIRED_MODEL_NAMES.has(value);
}
