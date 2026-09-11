import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { EXPECTED_HANDLE, LIMITS, RESOURCE_ID, SPACE, TASK_ID } from "./config.js";
import { CommonsAuthError, activationReceipt, addResourceVersion, getResource, loadCommonsKey, whoami } from "./commons.js";
import { gather, type Signal } from "./gather.js";
import { citedUrls, existingTitles, isDuplicate, mergeIntoResource, renderEntry, totalScore, type Accepted } from "./render.js";
import { CandidateSchema, SubmissionSchema } from "./schema.js";
import { ScoutRefusal, scout, type ScoutResult } from "./scout.js";
import { canonicalUrl, verifyEvidence } from "./verify.js";

// Exit codes: 0 published or nothing to publish; 1 unexpected error; 2 credential problem (pause the schedule);
// 3 quality gate tripped (too few sources verified); 4 model refusal.
const { values: args } = parseArgs({
  options: {
    publish: { type: "boolean", default: false },
    fixture: { type: "string" },
    out: { type: "string", default: "out" },
  },
});

const receipt: Record<string, unknown> = {
  run_id: new Date().toISOString(),
  mode: args.publish ? "publish" : "dry-run",
  space: SPACE,
  resource: RESOURCE_ID,
};

function finish(code: number, outcome: string): never {
  receipt.outcome = outcome;
  receipt.finished = new Date().toISOString();
  fs.mkdirSync(args.out!, { recursive: true });
  fs.writeFileSync(path.join(args.out!, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  process.exit(code);
}

async function loadFixture(file: string): Promise<ScoutResult> {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { submission: unknown; seenUrls: string[] };
  const s = SubmissionSchema.parse(raw.submission);
  return {
    candidates: s.candidates,
    notes: s.notes,
    seenUrls: raw.seenUrls,
    toolErrors: [],
    turns: 0,
    models: ["fixture"],
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

async function run(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Identity and start receipt.
  const key = loadCommonsKey();
  if (args.publish && !key) finish(2, "no Commons credential available for publishing");
  if (key) {
    const me = await whoami(key);
    receipt.identity = me.handle;
    if (me.handle !== EXPECTED_HANDLE || me.status !== "active") {
      finish(2, `credential belongs to @${me.handle} (${me.status}), expected active @${EXPECTED_HANDLE}`);
    }
  }
  const start = await activationReceipt();
  receipt.activation_pack_version = start.packVersion;
  receipt.start_cursor = start.cursor;
  receipt.start_content_digest = start.contentDigest;

  // 2. Current Resource: the durable state this run builds on.
  const resource = await getResource(RESOURCE_ID);
  receipt.base_version = resource.current_version;
  const titles = existingTitles(resource.content);
  const alreadyCited = citedUrls(resource.content);

  // 3. Leads.
  const gathered = await gather();
  receipt.signals = gathered.counts;
  receipt.gather_errors = gathered.errors;

  // 4. Scout.
  const result = args.fixture
    ? await loadFixture(args.fixture)
    : await scout({ signals: gathered.signals, existingTitles: titles, today, maxCandidates: LIMITS.maxNewCandidates });
  receipt.scout = {
    models: result.models,
    turns: result.turns,
    usage: result.usage,
    tool_errors: result.toolErrors,
    urls_seen: result.seenUrls.length,
    notes: result.notes,
  };

  // 5. Validate, dedupe, and verify every quote against the live page.
  const allowed = new Set<string>([...result.seenUrls, ...gathered.signals.map((s: Signal) => s.url)].map(canonicalUrl));
  const rejected: Array<{ title: string; reason: string }> = [];
  const accepted: Accepted[] = [];
  let checked = 0;
  let verified = 0;
  for (const raw of result.candidates) {
    const parsed = CandidateSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ title: String((raw as { title?: unknown })?.title ?? "?"), reason: `schema: ${parsed.error.issues[0]?.message}` });
      continue;
    }
    const c = parsed.data;
    if (isDuplicate(c.title, [...titles, ...accepted.map((a) => a.candidate.title)])) {
      rejected.push({ title: c.title, reason: "duplicate of an existing candidate" });
      continue;
    }
    if (c.evidence.every((e) => alreadyCited.has(canonicalUrl(e.url)))) {
      rejected.push({ title: c.title, reason: "no new evidence: every source is already cited in the list" });
      continue;
    }
    if (c.scores.R1 === 0 || c.scores.R2 === 0) {
      rejected.push({ title: c.title, reason: "stop flag: no named problem or no evidence of need" });
      continue;
    }
    const checks = await Promise.all(c.evidence.map((e) => verifyEvidence(e, allowed)));
    checked += checks.length;
    verified += checks.filter((x) => x.ok).length;
    const kept = c.evidence.map((item, i) => ({ item, check: checks[i] })).filter((x) => x.check.ok);
    if (!kept.length) {
      rejected.push({ title: c.title, reason: `no source verified: ${checks.map((x) => `${x.url} (${x.reason})`).join("; ")}` });
      continue;
    }
    accepted.push({ candidate: c, evidence: kept, total: totalScore(c) });
  }
  accepted.sort((a, b) => b.total - a.total);
  const toPublish = accepted.slice(0, LIMITS.maxNewCandidates);
  receipt.candidates = {
    submitted: result.candidates.length,
    evidence_checked: checked,
    evidence_verified: verified,
    accepted: toPublish.map((a) => ({ title: a.candidate.title, total: a.total, sources: a.evidence.map((e) => e.item.url) })),
    rejected,
  };

  if (checked > 0 && verified / checked < LIMITS.minVerifiedEvidenceRatio) {
    finish(3, `quality gate: only ${verified}/${checked} cited sources verified; nothing published`);
  }
  if (!toPublish.length) finish(0, "HEARTBEAT_OK: no new verified candidates; nothing published");

  // 6. Render. Only the scout's own marked block is rewritten; human-written sections are left untouched.
  const handle = (receipt.identity as string | undefined) ?? EXPECTED_HANDLE;
  const entries = toPublish.map((a) => renderEntry(a, today));
  const meta = { runDate: today, handle, taskId: TASK_ID, considered: result.candidates.length };
  const limits = { maxEntries: LIMITS.maxScoutedEntries, maxBytes: LIMITS.resourceMaxBytes };
  let next = mergeIntoResource(resource.content, entries, meta, limits);
  fs.mkdirSync(args.out!, { recursive: true });
  fs.writeFileSync(path.join(args.out!, "preview.md"), next);

  if (!args.publish) finish(0, `dry-run: ${toPublish.length} candidate(s) rendered to ${path.join(args.out!, "preview.md")}; nothing published`);

  // 7. Publish. Re-read right before writing; if a human edited meanwhile, rebuild on their version.
  const latest = await getResource(RESOURCE_ID);
  if (latest.current_version !== resource.current_version) {
    receipt.rebased_from = resource.current_version;
    next = mergeIntoResource(latest.content, entries, meta, limits);
  }
  const saved = await addResourceVersion(key!, RESOURCE_ID, next);
  const check = await getResource(RESOURCE_ID);
  if (check.content !== next) finish(1, `published version ${saved.current_version} but the read-back differs; inspect manually`);
  receipt.published_version = saved.current_version;
  receipt.end_cursor = (await activationReceipt()).cursor;
  finish(0, `published ${toPublish.length} candidate(s) as ${saved.current_version}`);
}

run().catch((err: unknown) => {
  if (err instanceof CommonsAuthError) finish(2, `Commons credential rejected: ${err.message}`);
  if (err instanceof ScoutRefusal) finish(4, `scout refusal: ${err.message}`);
  if (err instanceof Anthropic.AuthenticationError) finish(2, "Anthropic credential rejected");
  if (err instanceof Anthropic.APIConnectionError) finish(1, `Anthropic connection error: ${err.message}`);
  if (err instanceof Anthropic.APIError) finish(1, `Anthropic API error ${err.status}: ${err.message}`);
  finish(1, `error: ${(err as Error).message}`);
});
