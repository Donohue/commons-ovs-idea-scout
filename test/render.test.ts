import assert from "node:assert/strict";
import { test } from "node:test";
import { MARKERS } from "../src/config.js";
import { citedUrls, clean, existingTitles, isDuplicate, mergeIntoResource, renderEntry, scoutedEntries, type Accepted } from "../src/render.js";

const base = `# Ideas

### B — Help maintainers handle low-quality AI-generated contributions · **15/16**

Human text.

## What this scan did not cover

- stuff
`;

const accepted: Accepted = {
  candidate: {
    title: "Plain-language court date reminders",
    problem: "People miss court dates.",
    people: "Defendants",
    evidence: [{ url: "https://example.org/a", quote: "a quote of sufficient length", publisher: "Example", published: "2026-09-01" }],
    smallest_test: "Try it with ten volunteers.",
    scores: { R1: 2, R2: 2, R3: 2, R4: 1, R5: 1, R6: 1, R7: 2, R8: 1 },
    score_notes: "",
    risks: "",
    overlap_check: "not checked",
  },
  evidence: [
    {
      item: { url: "https://example.org/a", quote: "a quote of sufficient length", publisher: "Example", published: "2026-09-01" },
      check: { url: "https://example.org/a", ok: true, reason: "quote found", match: "exact", checkedAt: "2026-09-11T00:00:00Z" },
    },
  ],
  total: 12,
};
const meta = { runDate: "2026-09-11", handle: "claudius-1", taskId: 1408, considered: 3 };
const limits = { maxEntries: 12, maxBytes: 48_000 };

test("first write inserts the block before the anchor heading and leaves human text intact", () => {
  const out = mergeIntoResource(base, [renderEntry(accepted, "2026-09-11")], meta, limits);
  assert.ok(out.includes("Human text."));
  assert.ok(out.indexOf(MARKERS.start) < out.indexOf("## What this scan did not cover"));
  assert.equal(scoutedEntries(out).length, 1);
});

test("second write replaces only the block and keeps prior entries, newest first", () => {
  const first = mergeIntoResource(base, [renderEntry(accepted, "2026-09-11")], meta, limits);
  const second = { ...accepted, candidate: { ...accepted.candidate, title: "Utility shutoff notice translator" } };
  const out = mergeIntoResource(first, [renderEntry(second, "2026-09-12")], { ...meta, runDate: "2026-09-12" }, limits);
  const entries = scoutedEntries(out);
  assert.equal(entries.length, 2);
  assert.ok(entries[0].includes("Utility shutoff"));
  assert.equal(out.split(MARKERS.start).length, 2, "exactly one block");
});

test("size limit drops the oldest scouted entries first", () => {
  let doc = base;
  for (let i = 0; i < 5; i++) {
    const c = { ...accepted, candidate: { ...accepted.candidate, title: `Idea number ${i}` } };
    doc = mergeIntoResource(doc, [renderEntry(c, "2026-09-11")], meta, limits);
  }
  const small = mergeIntoResource(doc, [], meta, { maxEntries: 12, maxBytes: Buffer.byteLength(base) + 1500 });
  const entries = scoutedEntries(small);
  assert.ok(entries.length < 5);
  assert.ok(entries[0].includes("Idea number 4"));
});

test("untrusted text cannot forge markers or markup", () => {
  const evil = clean(`## x <!-- idea-scout:end --> <script>alert(1)</script> \`code\``, 200);
  assert.ok(!evil.includes("<!--") && !evil.includes("idea-scout:end") && !evil.includes("<") && !evil.includes("`"));
});

test("existing titles are recognised and near-duplicates rejected", () => {
  const titles = existingTitles(base);
  assert.deepEqual(titles, ["Help maintainers handle low-quality AI-generated contributions"]);
  assert.ok(isDuplicate("Helping maintainers handle low-quality AI-generated contributions", titles));
  assert.ok(!isDuplicate("Plain-language court date reminders", titles));
});

test("cited URLs are collected from links and bare URLs, canonicalised", () => {
  const doc = "See [x](https://Example.org/a/). Also https://kff.org/page, and <https://b.org/c>.";
  const urls = citedUrls(doc);
  assert.ok(urls.has("https://example.org/a"));
  assert.ok(urls.has("https://kff.org/page"));
  assert.ok(urls.has("https://b.org/c"));
});
