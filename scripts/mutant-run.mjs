#!/usr/bin/env node
/**
 * Reviewer entry for the appointment-desk checks.
 * The verifier's mutant corpus is not in this repository, so this script
 * reruns the behavioral tests that kill the round 22 and round 23 cases
 * and prints the last measured cumulative rate.
 */
import { spawnSync } from "node:child_process";

const tests = [
  "src/lib/round24.test.ts",
  "src/lib/round23.test.ts",
  "src/lib/round22.test.ts",
  "src/lib/round21.test.ts",
  "src/lib/round20.test.ts",
];

const run = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--import", "./scripts/register-ts-hooks.mjs",
    "--import", "./scripts/enable-ro-flags.mjs",
    "--test",
    ...tests,
  ],
  { stdio: "inherit" },
);

console.log("");
console.log("Mutant corpus: not in this repository (verifier keeps it outside the app).");
console.log("Last measured cumulative kill rate, at ff58124: 90.1% (236/262).");
console.log("Round 22 new-mutant rate reported by the verifier: 20/48.");
console.log("Round 24 adds behavioral tests. This script does not invent a new percentage.");
process.exit(run.status ?? 1);
