import assert from "node:assert/strict";
import { test } from "node:test";
import { CandidateSchema, SubmissionSchema, normalizeDate, truncate } from "../src/schema.js";

const base = {
  title: "Plain-language court date reminders",
  problem: "People miss court dates because notices are hard to read.",
  people: "Defendants",
  evidence: [{ url: "https://example.org/a", quote: "a quote of sufficient length", publisher: "Example", published: "2026-09-01" }],
  smallest_test: "Try it with ten volunteers.",
  scores: { R1: 2, R2: 2, R3: 2, R4: 1, R5: 1, R6: 1, R7: 2, R8: 1 },
  score_notes: "",
  risks: "",
  overlap_check: "not checked",
};

test("dates are normalised instead of rejected", () => {
  assert.equal(normalizeDate("2026-04-30T12:00:00Z"), "2026-04-30");
  assert.equal(normalizeDate("Published 2026-04-30, updated 2026-05-02"), "2026-04-30");
  assert.equal(normalizeDate("September 4, 2026"), "2026-09-04");
  assert.equal(normalizeDate("Unknown"), "unknown");
  const long = { ...base, evidence: [{ ...base.evidence[0], published: "Last reviewed in the spring of this year by staff" }] };
  assert.ok(CandidateSchema.safeParse(long).success);
});

test("over-long fields are trimmed at a word boundary, not rejected", () => {
  const r = CandidateSchema.safeParse({ ...base, risks: "word ".repeat(300), overlap_check: "x".repeat(900) });
  assert.ok(r.success);
  assert.ok(r.data.risks.length <= 500 && !r.data.risks.endsWith(" "));
  assert.ok(r.data.overlap_check.length <= 500);
  assert.equal(truncate("alpha beta gamma", 12), "alpha beta");
});

test("extra evidence items and candidates are dropped, not fatal", () => {
  const ev = Array.from({ length: 5 }, (_, i) => ({ ...base.evidence[0], url: `https://example.org/${i}` }));
  const r = CandidateSchema.safeParse({ ...base, evidence: ev });
  assert.ok(r.success);
  assert.equal(r.data.evidence.length, 3);
  const s = SubmissionSchema.parse({ candidates: Array.from({ length: 9 }, () => base), notes: "" });
  assert.equal(s.candidates.length, 6);
});

test("real defects still reject: too-short title, missing evidence, bad URL", () => {
  assert.ok(!CandidateSchema.safeParse({ ...base, title: "x" }).success);
  assert.ok(!CandidateSchema.safeParse({ ...base, evidence: [] }).success);
  assert.ok(!CandidateSchema.safeParse({ ...base, evidence: [{ ...base.evidence[0], url: "not a url" }] }).success);
});
