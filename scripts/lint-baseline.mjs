#!/usr/bin/env node
/**
 * lint-baseline — regenerate the known-failure baseline for the article gate.
 *
 * The baseline lets `lint-articles.mjs` keep working while the second-wave
 * backlog (#16–#36, deferred 2026-11-04) is still un-rewritten: those
 * articles are recorded with their current tic count, which then acts as a
 * ceiling. If one of them gets worse, the gate fails it.
 *
 * Usage:
 *   node scripts/lint-baseline.mjs            # show what the baseline would be
 *   node scripts/lint-baseline.mjs --write    # write scripts/lint-baseline.json
 *   node scripts/lint-baseline.mjs --prune    # write, dropping baselined
 *                                             # articles that now pass
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const BASELINE_FILE = join(ROOT, "scripts/lint-baseline.json");

const args = process.argv.slice(2);
const write = args.includes("--write");
const prune = args.includes("--prune");

const res = spawnSync(process.execPath, [join(ROOT, "scripts/lint-articles.mjs"), "--json"], {
  encoding: "utf8",
});
if (res.status === null) {
  console.error("could not run lint-articles.mjs");
  process.exit(2);
}
const report = JSON.parse(res.stdout);

const existing = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")).knownFailures || {}
  : {};

const next = {};
for (const r of report.results) {
  if (!r.errors.length) continue;
  const was = existing[r.name];
  if (prune && was !== undefined) continue; // repaired — drop it
  next[r.name] = { maxTic: r.tic, errors: r.errors.length };
}

const dropped = Object.keys(existing).filter((k) => !(k in next));
const added = Object.keys(next).filter((k) => !(k in existing));

console.log(`${Object.keys(next).length} known-failing article(s) in the baseline`);
if (added.length) console.log(`  + added:   ${added.join(", ")}`);
if (dropped.length) console.log(`  - dropped: ${dropped.join(", ")}`);

if (write) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify({ knownFailures: next }, null, 2) + "\n"
  );
  console.log(`wrote ${relative(process.cwd(), BASELINE_FILE)}`);
}
