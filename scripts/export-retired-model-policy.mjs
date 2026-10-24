import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { RETIRED_MODEL_POLICY } from "../open-sse/config/retiredModels.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const routerRoot = path.resolve(scriptDir, "..");
const args = new Map();
let checkOnly = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const flag = process.argv[index];
  if (flag === "--check") {
    checkOnly = true;
    continue;
  }
  const value = process.argv[index + 1];
  if (!flag?.startsWith("--") || !value || value.startsWith("--")) {
    throw new Error(`Expected flag/value pair, received '${flag || ""}'`);
  }
  args.set(flag.slice(2), path.resolve(value));
  index += 1;
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

if (checkOnly) {
  const mismatches = [];
  for (const [root, relativePath] of targets) {
    const outputPath = path.join(root, relativePath);
    let actual;
    try {
      actual = fs.readFileSync(outputPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        mismatches.push(`${outputPath} (missing)`);
        continue;
      }
      throw error;
    }
    if (actual.replace(/\r\n/g, "\n") !== content) mismatches.push(`${outputPath} (drifted)`);
  }
  if (mismatches.length) {
    process.stderr.write(`Retired-model policy projection drift detected:\n${mismatches.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${targets.length} retired-model policy projections are current\n`);
  }
} else {
for (const [root, relativePath] of targets) {
  const outputPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  process.stdout.write(`${outputPath}\n`);
}
}
