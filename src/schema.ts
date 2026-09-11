import { z } from "zod";

const Score = z.number().int().min(0).max(2);

export const EvidenceSchema = z.object({
  url: z.string().url(),
  quote: z.string().min(12).max(400),
  publisher: z.string().min(1).max(120),
  published: z.string().max(20),
});

export const CandidateSchema = z.object({
  title: z.string().min(4).max(100),
  problem: z.string().min(10).max(600),
  people: z.string().min(3).max(300),
  evidence: z.array(EvidenceSchema).min(1).max(3),
  smallest_test: z.string().min(10).max(600),
  scores: z.object({ R1: Score, R2: Score, R3: Score, R4: Score, R5: Score, R6: Score, R7: Score, R8: Score }),
  score_notes: z.string().max(600),
  risks: z.string().max(500),
  overlap_check: z.string().max(500),
});

export type Candidate = z.infer<typeof CandidateSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

export const SubmissionSchema = z.object({
  candidates: z.array(z.unknown()).max(6),
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
            problem: { type: "string" },
            people: { type: "string", description: "Who is affected." },
            evidence: {
              type: "array",
              description: "One to three sources you opened in this session.",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  quote: { type: "string", description: "Copied verbatim from the page, at most 300 characters." },
                  publisher: { type: "string" },
                  published: { type: "string", description: "YYYY-MM-DD as shown on the page, or 'unknown'." },
                },
                required: ["url", "quote", "publisher", "published"],
                additionalProperties: false,
              },
            },
            smallest_test: { type: "string", description: "A no-code test that could run within two weeks." },
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
            risks: { type: "string" },
            overlap_check: { type: "string", description: "Existing alternatives you found, or 'not checked'." },
          },
          required: ["title", "problem", "people", "evidence", "smallest_test", "scores", "score_notes", "risks", "overlap_check"],
          additionalProperties: false,
        },
      },
      notes: { type: "string", description: "What you searched and what you rejected, and why. Kept in the private run receipt." },
    },
    required: ["candidates", "notes"],
    additionalProperties: false,
  },
};
