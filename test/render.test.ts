import assert from "node:assert/strict";
import { test } from "node:test";
import { CHANGELOG, MARKERS, SCOUT_RESOURCE_NAME } from "../src/config.js";
import {
  citedUrls,
  clean,
  existingTitles,
  isDuplicate,
  mergeIntoScoutList,
  renderChangelogLine,
  renderEntry,
  scoutedEntries,
  upsertChangelog,
  type Accepted,
} from "../src/render.js";

const accepted: Accepted = {
  candidate: {
    title: "Court date reminders",
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
      check: { url: "https://example.org/a", ok: true, reason: "quote found", match: "exact", checkedAt: "2026-09-12T00:00:00Z" },
    },
  ],
  total: 12,
};
const meta = {
  runDate: "2026-09-12",
  handle: "claudius-1",
  taskId: 1408,
  shortlistUrl: "https://commons.diy/s/open-venture-studio/resources/res_shortlist",
  considered: 3,
};
const limits = { maxEntries: 12, maxBytes: 48_000 };
const entry = (title: string, date = "2026-09-12") => renderEntry({ ...accepted, candidate: { ...accepted.candidate, title } }, date);
const line = (date: string) =>
  renderChangelogLine({ runDate: date, titles: ["Court date reminders"], considered: 3, checked: 2, verified: 2, runUrl: "https://github.com/o/r/actions/runs/1" });

test("the first publish creates a standalone list that links to the reviewed shortlist", () => {
  const doc = mergeIntoScoutList(null, [entry("Court date reminders")], meta, limits, line("2026-09-12"));
  assert.ok(doc.startsWith(`# ${SCOUT_RESOURCE_NAME}`));
  assert.ok(doc.includes(`[candidate shortlist](${meta.shortlistUrl}), which the scout never edits`));
  assert.equal(scoutedEntries(doc).length, 1);
  assert.ok(doc.indexOf(MARKERS.end) < doc.indexOf(CHANGELOG.heading), "candidates come before the changelog");
  assert.ok(
    doc.includes(
      '- **2026-09-12, automated scout** — added 1 candidate: "Court date reminders". 3 considered; 2 of 2 cited sources verified. [Run log](https://github.com/o/r/actions/runs/1).',
    ),
  );
});

test("later runs add entries and changelog lines newest first, and keep notes people added", () => {
  const first = mergeIntoScoutList(null, [entry("Court date reminders")], meta, limits, line("2026-09-12"));
  const edited = first.replace(CHANGELOG.heading, `A note someone added by hand.\n\n${CHANGELOG.heading}`);
  const second = mergeIntoScoutList(edited, [entry("Utility shutoff notice translator", "2026-09-13")], { ...meta, runDate: "2026-09-13" }, limits, line("2026-09-13"));
  const entries = scoutedEntries(second);
  assert.equal(entries.length, 2);
  assert.ok(entries[0].includes("Utility shutoff"));
  assert.ok(second.includes("A note someone added by hand."));
  assert.equal(second.split(MARKERS.start).length, 2, "exactly one candidates block");
  const log = second.slice(second.indexOf(CHANGELOG.start), second.indexOf(CHANGELOG.end));
  assert.ok(log.indexOf("2026-09-13") < log.indexOf("2026-09-12"));
});

test("a list whose markers were removed gets a fresh block appended, keeping its text", () => {
  const out = mergeIntoScoutList("# Someone rewrote this\n\nTheir text.", [entry("Court date reminders")], meta, limits);
  assert.ok(out.startsWith("# Someone rewrote this\n\nTheir text."));
  assert.equal(scoutedEntries(out).length, 1);
});

test("the size limit drops the oldest entries first", () => {
  let doc: string | null = null;
  for (let i = 0; i < 5; i++) doc = mergeIntoScoutList(doc, [entry(`Idea number ${i}`)], meta, limits);
  const small = mergeIntoScoutList(doc, [], meta, { maxEntries: 12, maxBytes: Buffer.byteLength(doc!) - 1500 });
  const entries = scoutedEntries(small);
  assert.ok(entries.length < 5);
  assert.ok(entries[0].includes("Idea number 4"));
});

test("changelog lines are capped and stay in one marked block", () => {
  let doc = mergeIntoScoutList(null, [], meta, limits);
  for (let i = 1; i <= 4; i++) doc = upsertChangelog(doc, line(`2026-09-1${i}`), 3);
  assert.equal(doc.split(CHANGELOG.start).length, 2);
  const lines = doc.slice(doc.indexOf(CHANGELOG.start), doc.indexOf(CHANGELOG.end)).split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes("2026-09-14") && lines[2].includes("2026-09-12"));
});

test("a document without a Changelog heading gets one at the end", () => {
  const out = upsertChangelog("# Title\n\nText.", line("2026-09-12"));
  assert.ok(out.includes(`${CHANGELOG.heading}\n\n${CHANGELOG.start}`));
  assert.ok(out.trimEnd().endsWith(CHANGELOG.end));
});

test("duplicates are caught against both the shortlist and the scouted list", () => {
  const shortlist = "### B — Help maintainers handle low-quality AI-generated contributions · **15/16**\n\nSee [x](https://github.blog/a/).";
  const scouted = mergeIntoScoutList(null, [entry("Court date reminders")], meta, limits);
  const known = `${shortlist}\n${scouted}`;
  const titles = existingTitles(known);
  assert.deepEqual(titles, ["Help maintainers handle low-quality AI-generated contributions", "Court date reminders"]);
  assert.ok(isDuplicate("Helping maintainers handle low-quality AI-generated contributions", titles));
  assert.ok(isDuplicate("Court date reminder texts", titles));
  assert.ok(!isDuplicate("Utility shutoff notice translator", titles));
  assert.ok(citedUrls(known).has("https://github.blog/a"));
  assert.ok(citedUrls(known).has("https://example.org/a"));
});

test("untrusted text cannot forge markers or markup", () => {
  const evil = clean(`## x <!-- idea-scout:end --> <script>alert(1)</script> \`code\``, 200);
  assert.ok(!evil.includes("<!--") && !evil.includes("idea-scout:end") && !evil.includes("<") && !evil.includes("`"));
  assert.ok(!clean("x idea-scout:changelog:end y", 100).includes("idea-scout"));
});

test("cited URLs are collected from links and bare URLs, canonicalised", () => {
  const urls = citedUrls("See [x](https://Example.org/a/). Also https://kff.org/page, and <https://b.org/c>.");
  assert.ok(urls.has("https://example.org/a") && urls.has("https://kff.org/page") && urls.has("https://b.org/c"));
});
