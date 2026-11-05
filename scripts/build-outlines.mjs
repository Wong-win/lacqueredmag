#!/usr/bin/env node
/**
 * build-outlines — regenerate `scripts/article-outlines.json`.
 *
 * The gate needs to know what each article's H2 skeleton is supposed to be.
 * A rewrite that silently drops a section, renames one, or reorders them
 * produces prose that reads perfectly and a page that is missing half its
 * argument — which is exactly the failure the tic-based checks cannot see.
 * (It happened: two articles came back with no `##` headings at all and
 * still passed every other check.)
 *
 * Where the expected outline comes from, in priority order:
 *
 *   1. `scripts/outlines/spec-l2.json`    — the second-wave rewrites. These
 *      articles were rewritten against a fixed outline, so the spec is the
 *      authority and stays the authority.
 *   2. `scripts/outlines/spec-round2.json` — the third-wave backlog (#16–#36,
 *      #38, #39), deferred on 2026-11-04. These are marked `pending`: the
 *      outline is their target, not their current state, so the gate warns
 *      rather than fails until the backlog is worked through.
 *   3. The article file itself — for the articles that were never broken
 *      (#01–#15, #61). Their current headings are the outline.
 *
 * Usage:
 *   node scripts/build-outlines.mjs          # show what would be written
 *   node scripts/build-outlines.mjs --write  # write scripts/article-outlines.json
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ART = join(ROOT, "src/content/articles");
const OUTLINES = join(ROOT, "scripts/outlines");
const OUT_FILE = join(ROOT, "scripts/article-outlines.json");

const loadSpec = (file) =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

/** The `##` headings of a body, ignoring anything inside a fenced block. */
export function h2Headings(body) {
  const out = [];
  let fence = null;
  for (const line of body.split("\n")) {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (fence === f[1][0]) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Heading comparison ignores markdown emphasis and case. */
export const normalizeHeading = (h) =>
  h
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const l2 = loadSpec(join(OUTLINES, "spec-l2.json"));
const r2 = loadSpec(join(OUTLINES, "spec-round2.json"));

const articles = {};
for (const name of readdirSync(ART).filter((n) => n.endsWith(".md")).sort()) {
  const slug = basename(name, ".md");
  if (l2[slug]) {
    articles[name] = {
      status: "active",
      source: "spec-l2",
      headings: l2[slug].headings,
    };
  } else if (r2[slug]) {
    articles[name] = {
      status: "pending",
      source: "spec-round2",
      headings: r2[slug].headings,
    };
  } else {
    const raw = readFileSync(join(ART, name), "utf8");
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
    articles[name] = {
      status: "active",
      source: "file",
      headings: h2Headings(body),
    };
  }
}

const active = Object.values(articles).filter((a) => a.status === "active").length;
const pending = Object.values(articles).filter((a) => a.status === "pending").length;

console.log(
  `${Object.keys(articles).length} articles — ${active} active, ${pending} pending`
);

// Report every article whose current headings differ from its outline.
let drift = 0;
for (const [name, o] of Object.entries(articles)) {
  const raw = readFileSync(join(ART, name), "utf8");
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const actual = h2Headings(body).map(normalizeHeading);
  const expected = o.headings.map(normalizeHeading);
  if (actual.length === expected.length && actual.every((h, i) => h === expected[i])) continue;
  drift++;
  console.log(`\n${name}  (${o.status}, from ${o.source})`);
  console.log(`  outline: ${expected.join(" | ")}`);
  console.log(`  file:    ${actual.join(" | ")}`);
}
console.log(`\n${drift} article(s) differ from their registered outline`);

if (process.argv.includes("--write")) {
  const payload = {
    note:
      "Registered H2 skeletons. `active` = the gate fails the build if the " +
      "article's headings drift from this list; `pending` = the third-wave " +
      "backlog, where the outline is the target and a mismatch only warns. " +
      "Regenerate with `npm run lint:outlines`.",
    articles,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`wrote ${relative(process.cwd(), OUT_FILE)}`);
}
