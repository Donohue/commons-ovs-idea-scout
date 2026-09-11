import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { COMMONS_ORIGIN, EXPECTED_HANDLE, LIMITS, SCOUT_RESOURCE_NAME, SHORTLIST_RESOURCE_ID, SPACE, TASK_ID } from "./config.js";
import {
  CommonsAuthError,
  activationReceipt,
  addResourceVersion,
  createResource,
  findResourceByName,
  getResource,
  loadCommonsKey,
  whoami,
} from "./commons.js";
import { gather, type Signal } from "./gather.js";
import {
  citedUrls,
  existingTitles,
  isDuplicate,
  mergeIntoScoutList,
  renderChangelogLine,
  renderEntry,
  totalScore,
  type Accepted,
} from "./render.js";
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

const resourceUrl = (id: string) => `${COMMONS_ORIGIN}/s/${SPACE}/resources/${id}`;

const receipt: Record<string, unknown> = {
  run_id: new Date().toISOString(),
  mode: args.publish ? "publish" : "dry-run",
  space: SPACE,
  shortlist: SHORTLIST_RESOURCE_ID,
  scout_list_name: SCOUT_RESOURCE_NAME,
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
  const handle = (receipt.identity as string | undefined) ?? EXPECTED_HANDLE;
  const start = await activationReceipt();
  receipt.activation_pack_version = start.packVersion;
  receipt.start_cursor = start.cursor;
  receipt.start_content_digest = start.contentDigest;

  // 2. The reviewed shortlist (read only) and the scout's own list, if it exists yet. Both are used to avoid duplicates.
  const shortlist = await getResource(SHORTLIST_RESOURCE_ID);
  receipt.shortlist_version = shortlist.current_version;
  const found = await findResourceByName(SCOUT_RESOURCE_NAME, handle);
  const scoutList = found ? await getResource(found.id) : null;
  receipt.scout_list = scoutList ? { id: scoutList.id, base_version: scoutList.current_version } : "not created yet";
  const known = `${shortlist.content}\n${scoutList?.content ?? ""}`;
  const titles = existingTitles(known);
  const alreadyCited = citedUrls(known);

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
      rejected.push({
        title: String((raw as { title?: unknown })?.title ?? "?"),
        reason: `schema: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
      });
      continue;
    }
    const c = parsed.data;
    if (isDuplicate(c.title, [...titles, ...accepted.map((a) => a.candidate.title)])) {
      rejected.push({ title: c.title, reason: "duplicate of an existing candidate" });
      continue;
    }
    if (c.evidence.every((e) => alreadyCited.has(canonicalUrl(e.url)))) {
      rejected.push({ title: c.title, reason: "no new evidence: every source is already cited in the shortlist or the scouted list" });
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

  // 6. Render the next version of the scout's own list. The shortlist is never written.
  const entries = toPublish.map((a) => renderEntry(a, today));
  const runUrl =
    process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;
  const changelogLine = renderChangelogLine({
    runDate: today,
    titles: toPublish.map((a) => a.candidate.title),
    considered: result.candidates.length,
    checked,
    verified,
    runUrl,
  });
  receipt.changelog_line = changelogLine;
  const meta = { runDate: today, handle, taskId: TASK_ID, shortlistUrl: resourceUrl(SHORTLIST_RESOURCE_ID), considered: result.candidates.length };
  const limits = { maxEntries: LIMITS.maxScoutedEntries, maxBytes: LIMITS.resourceMaxBytes };
  let next = mergeIntoScoutList(scoutList?.content ?? null, entries, meta, limits, changelogLine);
  fs.mkdirSync(args.out!, { recursive: true });
  fs.writeFileSync(path.join(args.out!, "preview.md"), next);

  const target = scoutList ? `add a version to "${SCOUT_RESOURCE_NAME}"` : `create "${SCOUT_RESOURCE_NAME}"`;
  if (!args.publish) {
    finish(0, `dry-run: would ${target} with ${toPublish.length} candidate(s); preview in ${path.join(args.out!, "preview.md")}; nothing published`);
  }

  // 7. Publish. Re-read right before writing; if someone edited the list meanwhile, rebuild on their version.
  let savedId: string;
  let savedVersion: string;
  if (scoutList) {
    const latest = await getResource(scoutList.id);
    if (latest.current_version !== scoutList.current_version) {
      receipt.rebased_from = scoutList.current_version;
      next = mergeIntoScoutList(latest.content, entries, meta, limits, changelogLine);
    }
    const saved = await addResourceVersion(key!, scoutList.id, next);
    savedId = scoutList.id;
    savedVersion = saved.current_version;
  } else {
    const appeared = await findResourceByName(SCOUT_RESOURCE_NAME, handle);
    if (appeared) finish(1, `the scouted list was created by another run meanwhile (${appeared.id}); rerun to add to it`);
    const created = await createResource(key!, SCOUT_RESOURCE_NAME, next);
    savedId = created.id;
    savedVersion = created.current_version;
    receipt.created_scout_list = true;
  }
  const check = await getResource(savedId);
  if (check.content !== next) finish(1, `saved ${savedVersion} but the read-back differs; inspect ${resourceUrl(savedId)}`);
  receipt.scout_list = { id: savedId, published_version: savedVersion, url: resourceUrl(savedId) };
  receipt.end_cursor = (await activationReceipt()).cursor;
  finish(0, `published ${toPublish.length} candidate(s) to "${SCOUT_RESOURCE_NAME}" as ${savedVersion}`);
}

run().catch((err: unknown) => {
  if (err instanceof CommonsAuthError) finish(2, `Commons credential rejected: ${err.message}`);
  if (err instanceof ScoutRefusal) finish(4, `scout refusal: ${err.message}`);
  if (err instanceof Anthropic.AuthenticationError) finish(2, "Anthropic credential rejected");
  if (err instanceof Anthropic.APIConnectionError) finish(1, `Anthropic connection error: ${err.message}`);
  if (err instanceof Anthropic.APIError) finish(1, `Anthropic API error ${err.status}: ${err.message}`);
  finish(1, `error: ${(err as Error).message}`);
});
