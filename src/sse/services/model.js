// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes, getProviderConnections } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { assertSupportedModel, assertSupportedModelInfo, RetiredModelError } from "open-sse/config/retiredModels.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

async function resolveCompatibleNode(prefix, type) {
  const nodes = await getProviderNodes({ type });
  const matches = nodes.filter((node) => node.prefix === prefix);
  if (matches.length <= 1) return matches[0] || null;

  const activeConnections = await getProviderConnections({ isActive: true });
  const validatedMatches = matches.filter((node) => activeConnections.some(
    (connection) => connection.provider === node.id && connection.testStatus === "active"
  ));
  if (validatedMatches.length === 1) return validatedMatches[0];

  const providerNames = matches.map((node) => `${node.name || node.id} (${node.id})`).join(", ");
  throw new Error(
    `Ambiguous compatible provider prefix '${prefix}' for ${type}; ` +
    `validated active matches: ${validatedMatches.length}; candidates: ${providerNames}`
  );
}

export function parseModel(modelStr) {
  assertSupportedModel(modelStr);
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return assertSupportedModelInfo(
      { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] },
      modelStr,
    );
  }
  return assertSupportedModelInfo(parsed, modelStr);
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

async function resolveAliasTarget(alias) {
  const aliases = await getModelAliases();
  const seen = new Set();
  let current = alias;

  while (Object.prototype.hasOwnProperty.call(aliases, current)) {
    if (seen.has(current)) {
      const error = new Error(`Model alias cycle detected at '${current}'`);
      error.code = "MODEL_ALIAS_CYCLE";
      error.status = 400;
      throw error;
    }
    seen.add(current);
    const rawTarget = aliases[current];
    const target = typeof rawTarget === "string"
      ? rawTarget
      : rawTarget && typeof rawTarget === "object" && rawTarget.provider && rawTarget.model
        ? `${rawTarget.provider}/${rawTarget.model}`
        : null;
    if (!target) {
      const error = new Error(`Invalid model alias target for '${current}'`);
      error.code = "INVALID_MODEL_ALIAS";
      error.status = 400;
      throw error;
    }
    assertSupportedModel(target);
    if (!target.includes("/")) {
      current = target;
      continue;
    }
    const parsed = parseModelCore(target);
    const normalized = `${parsed.provider}/${parsed.model}`;
    assertSupportedModel(normalized);
    return assertSupportedModelInfo({ provider: parsed.provider, model: parsed.model }, target);
  }

  return null;
}

function assertResolvedTarget(modelInfo) {
  const target = modelInfo?.provider
    ? `${modelInfo.provider}/${modelInfo.model}`
    : modelInfo?.model;
  return assertSupportedModelInfo(modelInfo, target);
}

function assertExecutableCombo(combo) {
  if (!combo) return combo;
  if (combo.validity === "retired") {
    throw new RetiredModelError(combo.invalidModels?.[0] || combo.name);
  }
  if (combo.validity === "malformed") {
    const error = new Error(`Combo '${combo.name}' is malformed and cannot be executed`);
    error.code = "MALFORMED_COMBO";
    error.status = 400;
    throw error;
  }
  return combo;
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const matchedOpenAI = await resolveCompatibleNode(parsed.providerAlias, "openai-compatible");
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const matchedAnthropic = await resolveCompatibleNode(parsed.providerAlias, "anthropic-compatible");
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

      const matchedEmbedding = await resolveCompatibleNode(parsed.providerAlias, "custom-embedding");
      if (matchedEmbedding) {
        return { provider: matchedEmbedding.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    assertExecutableCombo(combo);
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  const aliasTarget = await resolveAliasTarget(parsed.model);
  if (aliasTarget) return assertResolvedTarget(aliasTarget);
  return assertResolvedTarget(await getModelInfoCore(modelStr, getModelAliases));
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  assertSupportedModel(modelStr);
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  assertExecutableCombo(combo);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
