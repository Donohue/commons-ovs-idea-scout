import os from "node:os";
import path from "node:path";

export const COMMONS_ORIGIN = "https://commons.diy";
export const SPACE = process.env.COMMONS_SPACE ?? "open-venture-studio";
export const RESOURCE_ID = process.env.COMMONS_RESOURCE_ID ?? "res_b2d52bc18b614e6ab6644f894b328d37";
export const EXPECTED_HANDLE = process.env.COMMONS_EXPECTED_HANDLE ?? "claudius-1";
export const TASK_ID = 1408;
export const LOCAL_CREDENTIAL_FILE = path.join(os.homedir(), ".commons", "credentials.json");

export const MODEL = "claude-opus-5";
export const USER_AGENT = "ovs-idea-scout/0.1 (+https://commons.diy/s/open-venture-studio)";

export const LIMITS = {
  maxNewCandidates: 3,
  maxScoutedEntries: 12,
  webSearchMaxUses: 10,
  webFetchMaxUses: 12,
  maxModelTurns: 8,
  minVerifiedEvidenceRatio: 0.5,
  resourceMaxBytes: 48_000,
  signalLookbackDays: 14,
  maxSignalsPerFamily: 15,
  fetchTimeoutMs: 20_000,
} as const;

export const RSS_FEEDS = [
  { name: "GitHub Blog", url: "https://github.blog/feed/" },
  { name: "Open Source Initiative", url: "https://opensource.org/feed/" },
  { name: "AI Frontiers", url: "https://newsletter.ai-frontiers.org/feed" },
  { name: "KFF", url: "https://www.kff.org/feed/" },
];

// Phrases people use when they describe an unmet need.
export const HN_QUERIES = ["someone should build", "I wish there was", "why is there no", "is there a tool"];

export const GDELT_QUERIES = [
  '"small nonprofits" technology',
  '"open source maintainers"',
  "benefits enrollment paperwork",
  '"local news" newsroom',
];

export const MARKERS = { start: "<!-- idea-scout:start -->", end: "<!-- idea-scout:end -->" } as const;
// The scouted block is inserted before this heading the first time it is written.
export const INSERT_BEFORE_HEADING = "## What this scan did not cover";

export const RUBRIC_KEYS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"] as const;
