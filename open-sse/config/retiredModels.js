export const RETIRED_MODEL_POLICY = Object.freeze({
  retiredModelNames: ["combo-web-high", "combo-web-medium"],
  retiredModelPrefixes: ["cgw/", "chatgpt-web/", "cg/"],
  retiredProviderIds: ["chatgpt-web"],
  providerAliases: { cg: "chatgpt-web" },
});

const RETIRED_MODEL_NAMES = new Set(RETIRED_MODEL_POLICY.retiredModelNames);
const RETIRED_MODEL_PREFIXES = RETIRED_MODEL_POLICY.retiredModelPrefixes;
const RETIRED_PROVIDER_IDS = new Set(RETIRED_MODEL_POLICY.retiredProviderIds);

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

export function isRetiredModelInfo(value) {
  if (!value || typeof value !== "object") return false;
  const provider = typeof value.provider === "string" ? value.provider : "";
  const model = typeof value.model === "string" ? value.model : "";
  return RETIRED_PROVIDER_IDS.has(provider) || isRetiredModel(`${provider}/${model}`);
}

export function assertSupportedModel(value) {
  if (isRetiredModel(value)) throw new RetiredModelError(value);
  return value;
}

export function assertSupportedModelInfo(value, originalValue = null) {
  if (isRetiredModelInfo(value)) {
    const canonicalValue = `${value.provider}/${value.model}`;
    throw new RetiredModelError(originalValue || canonicalValue);
  }
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
