#!/usr/bin/env python3
"""Split over-long paragraphs in LacqueredMag articles into house-length ones.

The rewrite batch came back with paragraphs averaging ~98 words against the
originals' ~51, which reads as a wall in a 720px column. Splitting at a
sentence boundary is grammatically safe and does not touch the prose, so
this is a mechanical pass — but a naive sentence splitter is not safe, and
the first version of this script damaged the batch twice:

  * it consumed a quote mark sitting after any sentence terminator, so
    `... "noise, in creative work…" not a bug.` lost its closing quote and
    the paragraph was left open;
  * it split at abbreviations, so `U.S. 1277739` and `Chanel No. 5` came
    apart mid-phrase.

This version fixes both. A boundary is only accepted when the token before
the terminator is not an abbreviation or an initial, when the next word
starts a new sentence, and when the split does not leave a quotation open
across the break. The prose is never altered: the text is cut at existing
whitespace and only the paragraph break is inserted.

Rules:
  - never split the first paragraph of an article (it carries the drop cap)
  - never split a paragraph that opens with a bold lead-in (**What does X...**)
  - never split lists, quotes, headings, images or tables
  - both halves must keep at least 20 words

Usage:
    python3 split_paragraphs.py <slug> [...]     # dry run, prints the plan
    python3 split_paragraphs.py --write <slug>   # apply
"""
import io, os, re, sys

ART = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src/content/articles")
TARGET = 55   # words per chunk (house median is 60)
CAP = 85      # no paragraph may exceed this after the pass (house p90 is 87)
MIN = 30      # neither half may fall below this (house p10 is 34)
OPEN_CAP = 140  # the opening paragraph may run to the house's longest (141)
OPEN_MIN = 40   # but if it is split, the drop cap keeps a paragraph of its own

# Terminator run, an optional closing quote, then the whitespace after it.
BOUNDARY = re.compile(r'([.!?…]+)([""”’]?)([ \t]+)')

# Words that end in a period without ending a sentence.
ABBREV = {
    "mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "no", "nos", "vol", "vs",
    "etc", "eg", "ie", "cf", "ca", "approx", "dept", "est", "fig", "figs", "inc",
    "ltd", "co", "corp", "ed", "eds", "pp", "al", "capt", "gen", "sen", "rep",
    "rev", "hon", "pres", "mt", "ft", "cm", "mm", "kg", "mg", "ml", "oz", "lb",
    "min", "max", "avg", "ref", "refs", "jan", "feb", "mar", "apr", "jun", "jul",
    "aug", "sep", "sept", "oct", "nov", "dec", "mon", "tue", "tues", "wed",
    "thu", "thur", "thurs", "fri", "sat", "sun", "u.s", "u.k", "a.m", "p.m",
    "dept", "verso", "ibid", "op", "cit", "seq", "ibid",
}

# A new sentence starts with one of these.
OPENER = re.compile(r'[A-Z0-9"“‘(\[*—]')


def _token_before(text, pos):
    """The word immediately before position `pos`, without trailing periods."""
    m = re.search(r'([A-Za-zÀ-ÿ0-9]+(?:\.[A-Za-zÀ-ÿ0-9]+)*)$', text[:pos])
    return m.group(1) if m else ""


def boundaries(text):
    """Positions after which a sentence could end, as (cut, quote_state) pairs.

    `cut` is the offset just past the whitespace that follows the sentence.
    `quote_state` is the number of double quotes before the cut — odd means
    a quotation is still open, so a break there would strand its opener.
    """
    out = []
    for m in BOUNDARY.finditer(text):
        term, closeq, ws = m.group(1), m.group(2), m.group(3)
        if not term:
            continue

        # An abbreviation, an initial or a decimal is not a sentence end.
        token = _token_before(text, m.start(1))
        if token:
            if len(token) == 1 and token.isalpha():
                continue                      # "U.S.", "e.g.", "J. K."
            if token.replace(".", "").isdigit():
                continue                      # "1.5", "21"
            if "." in token:
                continue                      # "e.g." and friends
            if token.lower() in ABBREV:
                continue

        # The next word must actually start a sentence.
        nxt = m.end(3)
        while nxt < len(text) and text[nxt] in " \t":
            nxt += 1
        if nxt >= len(text) or not OPENER.match(text[nxt]):
            continue

        state_before = text.count('"', 0, m.start(1))
        if state_before % 2 == 1:
            # We are inside a quotation. The only safe break is the one that
            # closes it — the terminator followed by its closing quote.
            if closeq != '"':
                continue
        cut = m.end(3) if closeq == '"' else m.end(1)
        out.append((cut, text.count('"', 0, cut)))
    return out


def split_sentences(text):
    """Split into sentences, keeping each one's trailing whitespace attached."""
    cuts = boundaries(text)
    chunks, prev = [], 0
    for cut, _ in cuts:
        chunks.append(text[prev:cut])
        prev = cut
    chunks.append(text[prev:])
    return chunks


def split_paragraph(para, first):
    words = para.split()
    if first:
        # The opening paragraph carries the drop cap and the house runs its
        # own first paragraphs long: median 72 words, longest 141. Leave it
        # be unless it outruns the house, and then give the drop cap a
        # paragraph of its own to sit in.
        if len(words) <= OPEN_CAP:
            return [para]
        return split_body(para, OPEN_MIN)
    return split_body(para, MIN)


def split_body(para, min_left):
    if len(para.split()) <= CAP:
        return [para]
    sents = split_sentences(para)
    if len(sents) < 2:
        return [para]
    counts = [len(s.split()) for s in sents]

    total = sum(counts)
    out, i = [], 0
    while True:
        cum_so_far = sum(counts[:i])
        if total - cum_so_far <= CAP:
            out.append("".join(sents[i:]).strip())
            break
        # Break at the sentence boundary that lands closest to the target.
        # The search runs over every later boundary, not just the ones inside
        # the greedy window: a boundary that leaves fewer than MIN words on
        # the left is no break at all.
        best, best_score = None, None
        cum = 0
        for k in range(i + 1, len(sents)):
            cum += counts[k - 1]
            left, right = cum, total - cum
            if left < min_left:
                continue
            if left > CAP or right < MIN:
                break
            score = abs(left - TARGET)
            if best_score is None or score < best_score:
                best, best_score = k, score
        if best is None:
            out.append("".join(sents[i:]).strip())
            break
        out.append("".join(sents[i:best]).strip())
        i = best
    return [p for p in out if p.strip()]


def process(path, write):
    slug = os.path.basename(path)[:-3]
    raw = io.open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.S)
    fm, body = m.group(1), m.group(2)
    # The body opens with a newline left over from the frontmatter. Left in
    # place it makes the opening paragraph look like a separator, and the
    # first two paragraphs of every article then go unsplit.
    body = body.lstrip("\n")
    blocks = re.split(r"(\n\s*\n)", body)
    out, changed, first_prose = [], 0, True
    for block in blocks:
        if not block.strip():
            out.append(block)
            continue
        t = block.strip()
        if t.startswith(("#", "!", "|", ">", "-", "*")) and not t.startswith("**"):
            out.append(block)
            continue
        if t.startswith("**"):
            out.append(block)
            continue
        pieces = split_paragraph(t, first_prose)
        if len(pieces) > 1:
            changed += 1
            print(f"  {slug}: split a {len(t.split())}-word paragraph into {len(pieces)}")
            for p in pieces:
                print(f"      · {p[:70]}…")
        out.append("\n\n" + "\n\n".join(pieces) + "\n\n")
        first_prose = False
    new_body = re.sub(r"\n{3,}", "\n\n", "".join(out)).strip() + "\n"
    if changed and write:
        io.open(path, "w", encoding="utf-8").write(f"---\n{fm}\n---\n{new_body}")
        print(f"  WROTE {slug} ({changed} paragraph(s) split)")
    return changed


if __name__ == "__main__":
    args = sys.argv[1:]
    write = "--write" in args
    args = [a for a in args if a != "--write"]
    for slug in args:
        process(os.path.join(ART, slug + ".md"), write)
