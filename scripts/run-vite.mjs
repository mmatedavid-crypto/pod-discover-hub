import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(repoRoot, "node_modules/.bin/vite");
const bundledNode = path.join(
  os.homedir(),
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node",
);

function canLoadRollupNative() {
  try {
    require("@rollup/rollup-darwin-arm64");
    return true;
  } catch {
    return false;
  }
}

function run(nodePath, args) {
  const child = spawnSync(nodePath, [viteBin, ...args], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (child.error) {
    console.error(child.error.message);
    process.exit(1);
  }
  process.exit(child.status ?? 1);
}

const args = process.argv.slice(2);
const viteArgs = args.length ? args : ["build"];

if (!canLoadRollupNative() && process.execPath !== bundledNode) {
  run(bundledNode, viteArgs);
}

run(process.execPath, viteArgs);
