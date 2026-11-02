#!/usr/bin/env node
/**
 * Flips one capacity guard at a time and reruns the capacity tests.
 * A mutant is killed when those tests fail. The file is restored afterward.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const capacityFile = new URL("../src/lib/capacity.ts", import.meta.url);
const storeFile = new URL("../src/lib/store.ts", import.meta.url);
const originals = new Map();

const mutants = [
  {
    name: "tech hours treat a full day as overloaded",
    file: capacityFile,
    from: "techUsed + adding > techCapacity + EPSILON",
    to: "techUsed + adding >= techCapacity",
  },
  {
    name: "advisor day treats a full day as overloaded",
    file: capacityFile,
    from: "advisorUsed + 1 > advisorCapacity",
    to: "advisorUsed + 1 >= advisorCapacity",
  },
  {
    name: "advisor hour treats the first visit as overloaded",
    file: capacityFile,
    from: "hourUsed + 1 > hourCap",
    to: "hourUsed + 1 >= hourCap",
  },
  {
    name: "waiter cap treats the first waiter as overloaded",
    file: capacityFile,
    from: "waiterAdding + waiterUsed > waiterCap",
    to: "waiterAdding + waiterUsed >= waiterCap",
  },
  {
    name: "arrival cap treats the first arrival as overloaded",
    file: capacityFile,
    from: "arrivalUsed + 1 > arrivalCap",
    to: "arrivalUsed + 1 >= arrivalCap",
  },
  {
    name: "time off no longer blocks the visit",
    file: capacityFile,
    from: `function timeOffHit(scheduling: SchedulingSettings, techId: string, iso: string, time: string, span: number): "day" | "part" | null {
  const blocks = blocksFor(scheduling, techId, iso);`,
    to: `function timeOffHit(scheduling: SchedulingSettings, techId: string, iso: string, time: string, span: number): "day" | "part" | null {
  return null;
  const blocks = blocksFor(scheduling, techId, iso);`,
  },
  {
    name: "a visit that ends when the block starts is blocked",
    file: capacityFile,
    from: "start < block.endMin && end > block.startMin",
    to: "start <= block.endMin && end >= block.startMin",
  },
  {
    name: "zero technician hours fall back to shop hours",
    file: capacityFile,
    from: "custom == null ? day.openHours : custom",
    to: "!custom ? day.openHours : custom",
  },
  {
    name: "a whole day off still has hours",
    file: capacityFile,
    from: "if (blocks.some((block) => block.whole)) return 0;",
    to: "if (false) return 0;",
  },
  {
    name: "online share hides a visit that lands exactly on the share",
    file: capacityFile,
    from: "return used + adding <= capacity * (percent / 100) + EPSILON;",
    to: "return used + adding < capacity * (percent / 100);",
  },
  {
    name: "online share ignores the advisor hour cap",
    file: capacityFile,
    from: "if (result.advisorHour.capacity != null && !fitsShare(result.advisorHour.used, result.advisorHour.adding, result.advisorHour.capacity, share)) return false;",
    to: "if (false) return false;",
  },
  {
    name: "online share ignores the waiter cap",
    file: capacityFile,
    from: "if (result.waiter.capacity != null && result.waiter.adding > 0 && !fitsShare(result.waiter.used, result.waiter.adding, result.waiter.capacity, share)) return false;",
    to: "if (false) return false;",
  },
  {
    name: "online share ignores the arrival cap",
    file: capacityFile,
    from: "if (result.arrivals.capacity != null && !fitsShare(result.arrivals.used, result.arrivals.adding, result.arrivals.capacity, share)) return false;",
    to: "if (false) return false;",
  },
  {
    name: "drop-off counts as a waiter",
    file: capacityFile,
    from: 'return lane === "waiter" || lane === "express";',
    to: 'return lane === "waiter" || lane === "express" || lane === "drop";',
  },
  {
    name: "an advisor can edit capacity",
    file: storeFile,
    from: `const who = serviceManager(state);
          if (refused || !who) {
            error = refused ?? "Only a service manager can change capacity.";
            return state;
          }
          const applied = applyCapacityLimits`,
    to: `const who = { id: state.workingAsId || "advisor", name: "Advisor" };
          if (false) {
            error = refused ?? "Only a service manager can change capacity.";
            return state;
          }
          const applied = applyCapacityLimits`,
  },
  {
    name: "saving a booking ignores pending requests",
    file: storeFile,
    from: `holds: requestHolds(state.onlineRequests),
          proposal: {
            date: input.date,`,
    to: `proposal: {
            date: input.date,`,
  },
];

function original(file) {
  const key = file.pathname;
  if (!originals.has(key)) originals.set(key, readFileSync(file, "utf8"));
  return originals.get(key);
}

function restore() {
  for (const [pathname, text] of originals) writeFileSync(pathname, text);
}

let killed = 0;
const survived = [];

try {
  for (const mutant of mutants) {
    const source = original(mutant.file);
    const hits = source.split(mutant.from).length - 1;
    if (hits !== 1) {
      survived.push(`${mutant.name} (snippet matched ${hits} times)`);
      continue;
    }
    writeFileSync(mutant.file, source.replace(mutant.from, mutant.to));
    const run = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        "./scripts/register-ts-hooks.mjs",
        "--import",
        "./scripts/enable-ro-flags.mjs",
        "--test",
        "src/lib/capacity-settings.test.ts",
        "src/lib/capacity.test.ts",
      ],
      { stdio: "ignore" },
    );
    restore();
    if (run.status === 0) survived.push(mutant.name);
    else killed += 1;
    process.stdout.write(run.status === 0 ? "survived " : "killed   ");
    process.stdout.write(`${mutant.name}\n`);
  }
} finally {
  restore();
}

const total = mutants.length;
const rate = total === 0 ? 0 : Math.round((killed / total) * 1000) / 10;
console.log("");
console.log(`Capacity guard mutants: ${killed}/${total} killed (${rate}%).`);
if (survived.length > 0) {
  console.log("Survived:");
  for (const name of survived) console.log(`- ${name}`);
}
process.exit(survived.length === 0 ? 0 : 1);
