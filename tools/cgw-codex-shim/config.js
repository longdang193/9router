import "./env.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function positiveInteger(value, name, { allowZero = false } = {}) {
  const number = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return number;
}

function booleanValue(value, name, fallback) {
  if (value == null || value === "") return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new Error(`${name} must be true or false`);
}

function requiredString(value, name) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function requiredLoopbackUrl(value, name) {
  const result = requiredString(value, name);
  let url;
  try { url = new URL(result); } catch { throw new Error(`${name} must be a valid URL`); }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${name} must be an http loopback URL`);
  }
  return result.replace(/\/$/, "");
}

export function parseModelAliases(raw) {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error("model aliases must be valid JSON");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("model aliases must be an object");
  }

  const aliases = {};
  for (const [alias, targetModel] of Object.entries(parsed)) {
    if (!alias.trim() || /\s/.test(alias)) throw new Error("model alias must be non-empty and contain no whitespace");
    const model = String(targetModel ?? "").trim();
    if (!model) throw new Error(`target model for alias ${alias} is required`);
    if (!model.startsWith("chatgpt-web/")) {
      throw new Error(`CGW target model for alias ${alias} must use the chatgpt-web/ browser route`);
    }
    aliases[alias] = model;
  }
  if (!Object.keys(aliases).length) throw new Error("at least one model alias is required");
  return Object.fromEntries(Object.entries(aliases).sort(([left], [right]) => left.localeCompare(right)));
}

export function loadConfig(env = process.env) {
  const host = String(env.CGW_SHIM_HOST || "127.0.0.1").trim();
  if (!LOOPBACK_HOSTS.has(host)) throw new Error("CGW_SHIM_HOST must be a loopback address");

  const apiKey = requiredString(env.CGW_SHIM_API_KEY, "CGW_SHIM_API_KEY");
  const modelAliases = parseModelAliases(env.CGW_SHIM_MODEL_ALIASES_JSON);
  const port = positiveInteger(env.CGW_SHIM_PORT ?? "20129", "CGW_SHIM_PORT", { allowZero: true });
  if (port > 65535) throw new Error("CGW_SHIM_PORT must be <= 65535");

  const cgwBaseUrl = requiredLoopbackUrl(env.CGW_SHIM_CGW_BASE_URL || "http://127.0.0.1:17841/v1", "CGW_SHIM_CGW_BASE_URL");

  return {
    host,
    port,
    apiKey,
    modelAliases,
    limits: {
      maxBodyBytes: positiveInteger(env.CGW_SHIM_MAX_BODY_BYTES ?? "65536", "CGW_SHIM_MAX_BODY_BYTES"),
      maxConcurrent: positiveInteger(env.CGW_SHIM_MAX_CONCURRENT ?? "1", "CGW_SHIM_MAX_CONCURRENT"),
      maxQueue: positiveInteger(env.CGW_SHIM_MAX_QUEUE ?? "8", "CGW_SHIM_MAX_QUEUE", { allowZero: true }),
      timeoutMs: positiveInteger(env.CGW_SHIM_TIMEOUT_MS ?? "120000", "CGW_SHIM_TIMEOUT_MS"),
      maxOutputBytes: positiveInteger(env.CGW_SHIM_MAX_OUTPUT_BYTES ?? "2097152", "CGW_SHIM_MAX_OUTPUT_BYTES"),
      terminationGraceMs: positiveInteger(env.CGW_SHIM_TERMINATION_GRACE_MS ?? "1500", "CGW_SHIM_TERMINATION_GRACE_MS"),
    },
    cgw: {
      baseUrl: cgwBaseUrl,
      bearerFile: String(env.CGW_SHIM_CGW_BEARER_FILE || "").trim() || null,
    },
  };
}
