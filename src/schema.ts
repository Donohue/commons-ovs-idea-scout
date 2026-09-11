import { z } from "zod";

const Score = z.number().int().min(0).max(2);

// Formatting is not a reason to discard a well-sourced candidate: trim over-long text at a word boundary instead of rejecting it.
// A trimmed quote stays a verbatim prefix of the original, so it still passes the page check.
export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

export function normalizeDate(s: string): string {
  const t = s.trim();
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const parsed = Date.parse(t);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return !t || /^unknown$/i.test(t) ? "unknown" : truncate(t, 40);
}

const text = (min: number, max: number) =>
  z
    .string()
    .transform((s) => truncate(s, max))
    .pipe(z.string().min(min));

export const EvidenceSchema = z.object({
  url: z.string().url(),
  quote: text(12, 400),
  publisher: text(1, 120),
  published: z.string().transform(normalizeDate),
});

export const CandidateSchema = z.object({
  title: text(4, 100),
  problem: text(10, 600),
  people: text(3, 300),
  evidence: z
    .array(EvidenceSchema)
    .min(1)
    .transform((items) => items.slice(0, 3)),
  smallest_test: text(10, 600),
  scores: z.object({ R1: Score, R2: Score, R3: Score, R4: Score, R5: Score, R6: Score, R7: Score, R8: Score }),
  score_notes: text(0, 600),
  risks: text(0, 500),
  overlap_check: text(0, 500),
});

export type Candidate = z.infer<typeof CandidateSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

export const SubmissionSchema = z.object({
  candidates: z.array(z.unknown()).transform((items) => items.slice(0, 6)),
  notes: z.string(),
});

const SCORE_JSON = { type: "integer", enum: [0, 1, 2] };

// Strict tool: the model returns its final list through this call.
export const SUBMIT_TOOL = {
  name: "submit_candidates",
  description:
    "Submit the final list of candidate problems. Call exactly once, after opening and quoting every source. An empty list is a valid submission.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short name for the problem, under 90 characters." },
            problem: { type: "string", description: "One to three sentences." },
            people: { type: "string", description: "Who is affected, in one sentence." },
            evidence: {
              type: "array",
              description: "One to three sources you opened in this session.",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  quote: { type: "string", description: "Copied verbatim from the page, at most 300 characters." },
                  publisher: { type: "string" },
                  published: { type: "string", description: "The date shown on the page as YYYY-MM-DD, or 'unknown'." },
                },
                required: ["url", "quote", "publisher", "published"],
                additionalProperties: false,
              },
            },
            smallest_test: { type: "string", description: "A no-code test that could run within two weeks, in one to three sentences." },
            scores: {
              type: "object",
              properties: {
                R1: SCORE_JSON, R2: SCORE_JSON, R3: SCORE_JSON, R4: SCORE_JSON,
                R5: SCORE_JSON, R6: SCORE_JSON, R7: SCORE_JSON, R8: SCORE_JSON,
              },
              required: ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"],
              additionalProperties: false,
            },
            score_notes: { type: "string", description: "One line of reasoning for any score of 0." },
            risks: { type: "string", description: "One or two sentences." },
            overlap_check: { type: "string", description: "One or two sentences: existing alternatives you found, or 'not checked'." },
          },
          required: ["title", "problem", "people", "evidence", "smallest_test", "scores", "score_notes", "risks", "overlap_check"],
          additionalProperties: false,
        },
      },
      notes: {
        type: "string",
        description: "What you searched and what you rejected, and why. This goes into the public run log, so keep it factual.",
      },
    },
    required: ["candidates", "notes"],
    additionalProperties: false,
  },
};
