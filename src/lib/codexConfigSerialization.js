import { stringifyTOML } from "confbox";

const quoteNumericLeadingRouterTable = (toml) =>
  toml.replace(/^(\[+model_providers)\.9router(?=\.|\])/gm, '$1."9router"');

export const serializeCodexConfig = (config) =>
  quoteNumericLeadingRouterTable(stringifyTOML(config));
