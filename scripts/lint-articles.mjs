#!/usr/bin/env node
/**
 * lint-articles — quality gate for LacqueredMag articles.
 *
 * Guards against the generation-collapse class of defect that hit articles
 * #31–#60 in Oct 2026: a recursive sentence chain ("The X is the Y. The Y is
 * the Z…") wrapped in a repeated tic, which reads as grammatical filler and
 * carries no facts. See the "v3 collapse" note in project memory.
 *
 * Usage:
 *   node scripts/lint-articles.mjs              # check every article
 *   node scripts/lint-articles.mjs --only 51-  # check a subset by filename
 *   node scripts/lint-articles.mjs --json       # machine-readable output
 *
 * Exit code 1 if any article fails. Warnings never fail the build.
 *
 * WHAT IS CHECKED
 *
 *   1–3  the tic itself: "in our view", filler "finally", and adjacent
 *        sentences that share a grammatical shape
 *   4    content density (a warning)
 *   5    hard corruption: CJK, Cyrillic, fused function words
 *   6    frontmatter hygiene: excerpt length, tics in dek/excerpt/caption
 *   7    the collapse's other habits: italic density, the stock
 *        "most over-X and most under-Y" pair
 *   8    the H2 skeleton against `scripts/article-outlines.json`
 *
 * Check 8 exists because prose can pass every other check and still be a
 * broken article: two rewrites came back with no `##` headings at all, so
 * the page had no sections and no argument, and the tic-based checks were
 * green. `scripts/article-outlines.json` records the skeleton each article
 * must have; regenerate it with `npm run lint:outlines`.
 *
 * BASELINE. `scripts/lint-baseline.json` lists articles that are known to
 * fail and have not been repaired yet — currently the third-wave articles
 * #16–#36, #38, #39, deferred by decision on 2026-11-04. A baselined
 * article does not fail the build, but its recorded tic count is a ceiling:
 * if the tic count rises above the baseline, that is a regression and DOES
 * fail the build. Anything not on the baseline that fails is a hard error.
 *
 * The baseline only ever excuses a COLLAPSE error. A structural error — a
 * missing H2 section, a corrupted character, a broken frontmatter field —
 * fails the build whether the article is baselined or not, because those
 * are not "not yet repaired", they are "wrong".
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ARTICLES = join(ROOT, "src/content/articles");

// ---------------------------------------------------------------- thresholds
const T = {
  maxTicPerArticle: 5, // literal tic phrases in the whole article
  maxTicSentenceRatio: 0.15, // share of sentences carrying a tic
  maxAdjacentDupRatio: 0.4, // share of adjacent sentence pairs sharing a shape
  minFacts: 3, // concrete checkable details (price/year/brand/measure)
  minFactsForRewrite: 3,
  maxItalicsPerSentence: 0.45, // the collapse italicises a word in nearly every sentence
};

// ------------------------------------------------------------------ patterns
const TIC_PHRASE = /\bin our view\b/gi;
// "finally" used as an in-clause filler rather than sentence-final "at last"
const TIC_FILLER = /\bfinally\b(?=[^.!?]*[,;])/gi;
const GLUE_HEADS = new Set(
  ("is are was were the and not of to in for with on at an be by from has have had it that this " +
   "as so or no can will would could should must may might do does did if up out")
    .split(" ")
);
const GLUE_RE = /\b([a-z]{2,5})([a-z]{3,})\b/g;
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
const CYRILLIC = /[Ѐ-ӿ]/;

const FACT_PATTERNS = [
  /[$€£¥]\s?\d[\d,.]*/g, // prices
  /\b\d+(?:\.\d+)?\s?%/g, // percentages
  /\b(?:1[5-9]\d{2}|20[0-2]\d)\b/g, // years 1500–2029
  /\b\d+(?:\.\d+)?\s?(?:mm|cm|ml|mg|g|oz|fl oz|inch|inches)\b/gi, // measurements
  /\b\d+(?:\.\d+)?\s?(?:hours?|minutes?|days?|weeks?|months?|years?)\b/gi, // durations
];

const FUNCTION_WORDS = new Set(
  ("a an the of to in for with on at by from and or but is are was were be been being " +
   "it its this that these those as so than then there here he she they we you i " +
   "not no do does did have has had can could would should will shall may might must " +
   "what which who whom whose when where why how if while because although though " +
   "more most less least very much many any some all both each every other another " +
   "such own same too just only even still yet ever never always")
    .split(" ")
);

// -------------------------------------------------------------------- helpers
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

function splitFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : { fm: "", body: raw };
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/^\s*\|.*$/gm, " ")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/^\s*---\s*$/gm, " ");
}

function sentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z“"'*])/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);
}

/** Shape of a sentence: its function-word sequence, content words erased. */
function shape(sentence) {
  return (sentence.toLowerCase().match(/[a-z']+/g) || [])
    .map((w) => (FUNCTION_WORDS.has(w) ? w : "·"))
    .join(" ");
}

function jaccard(a, b) {
  const A = new Set(a.split(" "));
  const B = new Set(b.split(" "));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

function facts(body) {
  const found = new Set();
  for (const re of FACT_PATTERNS) for (const m of body.match(re) || []) found.add(m.trim().toLowerCase());
  return found.size;
}

function properNouns(body) {
  const stripped = body.replace(/^\s*[A-Z][^\n.]*\./gm, ""); // drop sentence openers
  return new Set((stripped.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g) || [])).size;
}

/**
 * Fused function-word pairs ("isthe", "isdoing") are a real defect only when
 * the joined token never occurs on its own anywhere in the corpus — otherwise
 * "doing", "without" and "another" are just English words that happen to start
 * with a function word.
 */
function gluedTokens(body, vocab) {
  const found = new Set();
  for (const m of body.matchAll(GLUE_RE)) {
    const [, head, tail] = m;
    if (!GLUE_HEADS.has(head)) continue;
    const fused = head + tail;
    if (vocab.has(fused)) continue; // it is a real word, used standalone
    if (!vocab.has(head) || !vocab.has(tail)) continue; // not a fusion we can prove
    found.add(fused);
  }
  return [...found];
}

// -------------------------------------------------------------------- checks
/**
 * Errors come in two kinds. `collapse` is the generation-collapse tic and
 * its relatives — a baselined article is allowed to keep its current tic
 * count while it waits in the rewrite backlog. `structure` is a defect in
 * the article's shape: a missing section, a corrupted character, a broken
 * frontmatter field. No baseline can excuse those; they always fail.
 */
const collapse = (msg) => ({ kind: "collapse", msg });
const structure = (msg) => ({ kind: "structure", msg });

/** The `##` headings of a body, ignoring anything inside a fenced block. */
function h2Headings(body) {
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
const normalizeHeading = (h) =>
  h
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function lint(file, vocab, outlines) {
  const raw = readFileSync(file, "utf8");
  const { fm, body } = splitFrontmatter(raw);
  const text = stripMarkdown(body);
  const sents = sentences(text);

  const errors = [];
  const warns = [];

  // 1 — tic phrases anywhere in the article
  const phraseHits = (body.match(TIC_PHRASE) || []).length;
  const fillerHits = (body.match(TIC_FILLER) || []).length;
  const ticTotal = phraseHits + fillerHits;
  if (ticTotal > T.maxTicPerArticle) {
    errors.push(
      collapse(
        `tic x${ticTotal} (limit ${T.maxTicPerArticle}) — "in our view" x${phraseHits}, filler "finally" x${fillerHits}`
      )
    );
  }

  // 2 — share of sentences carrying a tic
  let ticSents = 0;
  for (const s of sents) {
    if (/\bin our view\b/i.test(s) || /\bfinally\b(?=[^.!?]*[,;])/i.test(s)) ticSents++;
  }
  const ratio = sents.length ? ticSents / sents.length : 0;
  if (ratio > T.maxTicSentenceRatio) {
    errors.push(
      collapse(`tic in ${(ratio * 100).toFixed(0)}% of sentences (limit ${T.maxTicSentenceRatio * 100}%)`)
    );
  }

  // 3 — adjacent sentences sharing the same grammatical shape
  let dupPairs = 0;
  for (let i = 1; i < sents.length; i++) {
    if (jaccard(shape(sents[i - 1]), shape(sents[i])) > 0.82) dupPairs++;
  }
  const dupRatio = sents.length > 1 ? dupPairs / (sents.length - 1) : 0;
  if (dupRatio > T.maxAdjacentDupRatio) {
    errors.push(
      collapse(
        `adjacent sentences share a shape in ${(dupRatio * 100).toFixed(0)}% of pairs (limit ${T.maxAdjacentDupRatio * 100}%)`
      )
    );
  }

  // 4 — content density: an article with no checkable facts is filler
  const f = facts(text);
  const pn = properNouns(text);
  if (f < T.minFacts && sents.length > 30) {
    warns.push(`only ${f} concrete facts (${pn} proper nouns) in ${sents.length} sentences`);
  }

  // 5 — hard corruption
  if (CJK.test(body)) errors.push(structure("CJK characters present"));
  if (CYRILLIC.test(body)) errors.push(structure("Cyrillic characters present"));
  const glued = gluedTokens(body, vocab);
  if (glued.length) errors.push(structure(`glued tokens: ${glued.slice(0, 6).join(", ")}`));

  // 6 — frontmatter hygiene
  const ex = fm.match(/^excerpt:\s*"(.*)"\s*$/m);
  if (ex && (ex[1].length < 40 || ex[1].length > 220)) {
    errors.push(structure(`excerpt length ${ex[1].length} outside schema range 40-220`));
  }
  for (const fd of ["dek", "excerpt", "imageCaption"]) {
    const m = fm.match(new RegExp(`^${fd}:\\s*"(.*)"\\s*$`, "m"));
    if (m && /\bin our view\b/i.test(m[1])) errors.push(collapse(`${fd} contains the tic`));
    if (m && /\bfinally\b(?=[^.]*[,;])/i.test(m[1])) errors.push(collapse(`${fd} uses filler "finally"`));
  }

  // 7 — the collapsed writer's other tics. Italic density is the sharpest
  // separator: the healthy corpus runs 0.00–0.40 italicised terms per
  // sentence, the collapsed articles run 0.46–3.57.
  const italics = (body.match(/(?<!\*)\*([^*\n]+)\*(?!\*)/g) || []).length;
  const perSentence = sents.length ? italics / sents.length : 0;
  if (perSentence > T.maxItalicsPerSentence) {
    errors.push(
      collapse(
        `${italics} italicised terms in ${sents.length} sentences (${perSentence.toFixed(2)} per sentence, limit ${T.maxItalicsPerSentence}) — the collapse italicises a word in nearly every sentence`
      )
    );
  }
  // The stock pair only counts as the tic when both halves sit in the same
  // sentence — "the most over-engineered product category" on its own is
  // ordinary English.
  const stockPair = body.match(
    /most\s+over-[^.]*?most\s+under-|most\s+under-[^.]*?most\s+over-/gi
  );
  if (stockPair) {
    errors.push(collapse('uses the stock pair "most over-X and most under-Y"'));
  }

  // 8 — the H2 skeleton. Prose can pass every check above and still be a
  // broken article: two rewrites came back with no `##` headings at all, so
  // the page had no sections, no contents and no argument, and every other
  // check was green. `scripts/article-outlines.json` records the skeleton
  // each article must have.
  const outline = outlines[basename(file)];
  if (!outline) {
    warns.push(
      "no outline registered — run `npm run lint:outlines` to record this article's H2 skeleton"
    );
  } else {
    const actual = h2Headings(body).map(normalizeHeading);
    const expected = outline.headings.map(normalizeHeading);
    const same =
      actual.length === expected.length && actual.every((h, i) => h === expected[i]);
    if (!same) {
      const msg = `H2 skeleton does not match the registered outline — expected [${expected.join(
        " | "
      )}], found [${actual.join(" | ")}]`;
      if (outline.status === "pending") {
        warns.push(`${msg} — structure is not enforced while this article is in the rewrite backlog`);
      } else {
        errors.push(structure(msg));
      }
    }
  }

  return {
    file: relative(ARTICLES, file),
    name: basename(file),
    sentences: sents.length,
    tic: ticTotal,
    ticRatio: ratio,
    dupRatio,
    facts: f,
    properNouns: pn,
    errors,
    warns,
  };
}

// ----------------------------------------------------------------------- main
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const asJson = args.includes("--json");

// Known-failure baseline. Articles listed here are known-broken and awaiting
// repair; they do not fail the build, but their recorded tic count is a
// ceiling — a rise above it is a regression and does fail the build.
//
// The baseline only ever excuses a COLLAPSE error. A structural error — a
// missing H2 section, a corrupted character, a broken frontmatter field —
// fails the build whether the article is baselined or not, because those
// are not "not yet repaired", they are "wrong".
const BASELINE_FILE = join(ROOT, "scripts/lint-baseline.json");
let baseline = {};
if (existsSync(BASELINE_FILE)) {
  const raw = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  baseline = raw.knownFailures || {};
}

// Registered H2 skeletons. Missing file means no article is checked for
// structure, which is loud enough on its own.
const OUTLINE_FILE = join(ROOT, "scripts/article-outlines.json");
let outlines = {};
if (existsSync(OUTLINE_FILE)) {
  const raw = JSON.parse(readFileSync(OUTLINE_FILE, "utf8"));
  outlines = raw.articles || {};
} else {
  console.warn(
    "warning: scripts/article-outlines.json is missing — no article will be checked for H2 structure"
  );
}

let files = walk(ARTICLES).sort();
if (only) files = files.filter((f) => basename(f).startsWith(only) || relative(ARTICLES, f).includes(only));

// corpus vocabulary: every token that occurs standalone somewhere on the site
const vocab = new Set();
for (const f of walk(ARTICLES)) {
  const { body } = splitFrontmatter(readFileSync(f, "utf8"));
  for (const w of stripMarkdown(body).toLowerCase().match(/[a-z']{2,}/g) || []) vocab.add(w);
}

const results = files.map((f) => lint(f, vocab, outlines));

// Split failures into "real" and "baselined". A baselined failure is a known
// article; a real failure is anything else, a baselined article whose tic
// count has gone UP since it was baselined, or any article with a structural
// error.
const realFailures = [];
const knownFailures = [];
const fixed = [];
for (const r of results) {
  const bl = baseline[r.name];
  if (!r.errors.length) {
    if (bl) fixed.push(r.name);
    continue;
  }
  if (bl === undefined) {
    realFailures.push(r);
    continue;
  }
  const structural = r.errors.filter((e) => e.kind === "structure");
  if (structural.length) {
    realFailures.push(r);
    r.errors.push(
      structure(
        `${structural.length} structural error(s) on a baselined article — the baseline excuses a collapse backlog, not a broken article`
      )
    );
    continue;
  }
  const limit = typeof bl === "object" ? bl.maxTic : bl;
  if (typeof limit === "number" && r.tic > limit) {
    realFailures.push(r);
    r.errors.push(
      collapse(
        `tic x${r.tic} exceeds the baselined ceiling of ${limit} for this known-failure article — that is a regression, not a backlog item`
      )
    );
  } else {
    knownFailures.push(r);
  }
}

const warned = results.filter((r) => !r.errors.length && r.warns.length);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        total: results.length,
        failed: realFailures.length,
        knownFailed: knownFailures.length,
        warned: warned.length,
        results,
      },
      null,
      2
    )
  );
} else {
  for (const r of realFailures) {
    console.log(`FAIL  ${r.name}`);
    for (const e of r.errors) console.log(`        ${e.msg}`);
  }
  for (const r of knownFailures) {
    console.log(`KNOWN ${r.name}  (${r.errors.length} error(s), baselined — awaiting rewrite)`);
  }
  for (const r of warned) {
    console.log(`WARN  ${r.name}`);
    for (const w of r.warns) console.log(`        ${w}`);
  }
  if (fixed.length) {
    console.log(`\nrepaired since the last baseline (${fixed.length}):`);
    for (const n of fixed) console.log(`  + ${n}`);
  }
  console.log(
    `\n${results.length} articles checked — ${realFailures.length} failed, ${knownFailures.length} known-failing (baselined), ${warned.length} warned`
  );
}

process.exit(realFailures.length ? 1 : 0);
