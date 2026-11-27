import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const patch = path.join(root, "scripts/mutants/m1.patch");

function git(args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

const check = git(["apply", "--check", patch]);
if (check.status !== 0) {
  process.stderr.write(check.stderr || check.stdout);
  process.exit(check.status ?? 1);
}

git(["apply", patch]);
const test = spawnSync(process.execPath, [
  "--experimental-strip-types",
  "--import", "./scripts/register-ts-hooks.mjs",
  "--import", "./scripts/enable-ro-flags.mjs",
  "--test",
  "--test-name-pattern", "keeps Friday Paste open",
  "src/lib/round26-paste.test.ts",
], { cwd: root, encoding: "utf8" });
const restored = git(["apply", "-R", patch]);
if (restored.status !== 0) {
  process.stderr.write(restored.stderr || restored.stdout);
  process.exit(restored.status ?? 1);
}
process.stdout.write(test.stdout ?? "");
process.stderr.write(test.stderr ?? "");
process.exit(test.status ?? 1);
