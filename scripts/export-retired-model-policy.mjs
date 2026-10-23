import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { RETIRED_MODEL_POLICY } from "../open-sse/config/retiredModels.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const routerRoot = path.resolve(scriptDir, "..");
const args = new Map();

for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  const value = process.argv[index + 1];
  if (!flag?.startsWith("--") || !value) {
    throw new Error(`Expected flag/value pair, received '${flag || ""}'`);
  }
  args.set(flag.slice(2), path.resolve(value));
}

const projection = {
  schemaVersion: 1,
  owner: "9router/open-sse/config/retiredModels.js",
  ...RETIRED_MODEL_POLICY,
};
const content = `${JSON.stringify(projection, null, 2)}\n`;

const targets = [
  [routerRoot, "open-sse/config/retired-model-policy.json"],
  [routerRoot, "scripts/retired-model-policy.json"],
  [args.get("project-os"), "repo_config/retired-model-policy.json"],
  [args.get("project-os"), "scripts/retired-model-policy.json"],
  [args.get("lightrsi"), "components/presets/tokenpilot/retired-model-policy.json"],
].filter(([root]) => root);

for (const [root, relativePath] of targets) {
  const outputPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  process.stdout.write(`${outputPath}\n`);
}
