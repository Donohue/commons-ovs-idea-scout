import { CHANGELOG, MARKERS, RUBRIC_KEYS, SCOUT_RESOURCE_NAME } from "./config.js";
import type { Candidate, Evidence } from "./schema.js";
import { canonicalUrl, type EvidenceCheck } from "./verify.js";

export interface Accepted {
  candidate: Candidate;
  evidence: Array<{ item: Evidence; check: EvidenceCheck }>;
  total: number;
}

export const totalScore = (c: Candidate) => RUBRIC_KEYS.reduce((sum, k) => sum + c.scores[k], 0);

const STOPWORDS = new Set(["the", "and", "for", "with", "help", "people", "their", "from", "into", "that", "this", "tool", "tools"]);

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)), // "reminders" matches "reminder"
  );
}

export function similarity(a: string, b: string): number {
  const x = titleTokens(a);
  const y = titleTokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}

// Titles of every "### " entry, in the shortlist or the scouted list.
export function existingTitles(content: string): string[] {
  return [...content.matchAll(/^###\s+(.+)$/gm)].map((m) =>
    m[1]
      .replace(/^[A-Z]\s+[—-]\s+/, "")
      .split(" · ")[0]
      .trim(),
  );
}

// Every https URL cited anywhere in a document.
export function citedUrls(content: string): Set<string> {
  return new Set([...content.matchAll(/https:\/\/[^\s)\]>"'<]+/g)].map((m) => canonicalUrl(m[0].replace(/[.,;:]+$/, ""))));
}

export const isDuplicate = (title: string, existing: string[]) => existing.some((t) => similarity(title, t) >= 0.5);

// Untrusted model and page text goes into shared Markdown: flatten it and remove anything that could forge markers or markup.
export function clean(s: string, max: number): string {
  const flat = s
    .replace(/<!--|-->/g, " ")
    .replace(/idea-scout:[\w:-]*/gi, " ")
    .replace(/[<>`]/g, "")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const safeUrl = (u: string) => encodeURI(decodeURI(u)).replace(/\(/g, "%28").replace(/\)/g, "%29");

export function renderEntry(a: Accepted, runDate: string): string {
  const c = a.candidate;
  const scores = RUBRIC_KEYS.map((k) => `${k} ${c.scores[k]}`).join(" · ");
  const evidence = a.evidence
    .map(({ item, check }) => {
      const label = clean(`${item.publisher}, ${item.published}`, 140);
      return `  - "${clean(item.quote, 320)}" [${label}](${safeUrl(item.url)}). Quote ${check.match === "exact" ? "matched" : "closely matched"} on the live page ${check.checkedAt.slice(0, 10)}.`;
    })
    .join("\n");
  const notes = c.score_notes.trim() ? ` (${clean(c.score_notes, 240)})` : "";
  return [
    `### ${clean(c.title, 90)} · ${a.total}/16 · scouted ${runDate}`,
    "",
    `- **Problem:** ${clean(c.problem, 500)}`,
    `- **People:** ${clean(c.people, 240)}`,
    `- **Evidence:**`,
    evidence,
    `- **Smallest test:** ${clean(c.smallest_test, 500)}`,
    `- **Scores:** ${scores}${notes}`,
    `- **Risks:** ${clean(c.risks, 400) || "none stated"}`,
    `- **Overlap:** ${clean(c.overlap_check, 400) || "not checked"}`,
    `- **Status:** candidate, automated and unreviewed.`,
  ].join("\n");
}

export function scoutedEntries(content: string): string[] {
  const start = content.indexOf(MARKERS.start);
  const end = content.indexOf(MARKERS.end);
  if (start < 0 || end < start) return [];
  return content
    .slice(start + MARKERS.start.length, end)
    .split(/^(?=### )/m)
    .filter((s) => s.startsWith("### "))
    .map((s) => s.trim());
}

export interface ListMeta {
  runDate: string;
  handle: string;
  taskId: number;
  shortlistUrl: string;
  considered: number;
}

export function renderBlock(entries: string[], meta: ListMeta & { added: number }): string {
  return [
    MARKERS.start,
    "## Candidates",
    "",
    `_Last update ${meta.runDate}: ${meta.added} added from ${meta.considered} considered. ${entries.length} shown, newest first; older entries remain in version history._`,
    "",
    entries.join("\n\n"),
    MARKERS.end,
  ].join("\n");
}

// The standalone list the first publishing run creates. People may edit anything outside the marked sections.
export function renderTemplate(meta: ListMeta): string {
  return [
    `# ${SCOUT_RESOURCE_NAME}`,
    "",
    `This list is kept by an automated scout run by \`@${meta.handle}\` for task #${meta.taskId}. It is separate from the reviewed [candidate shortlist](${meta.shortlistUrl}), which the scout never edits.`,
    "",
    "- **How entries get here:** once a day the scout looks for new candidate problems and adds at most three. Before adding one, it opens every cited page and checks that the quote is actually there. Anything it cannot verify is dropped.",
    "- **What an entry is:** a lead for people to judge, not a decision. The scores are a model's first judgment, and a quote being on a page does not prove it supports the idea.",
    `- **To adopt an entry:** propose it for the shortlist in the #${meta.taskId} thread.`,
    `- **To pause the scout:** say so in the #${meta.taskId} thread.`,
    "",
    MARKERS.start,
    MARKERS.end,
    "",
    CHANGELOG.heading,
    "",
  ].join("\n");
}

export interface RunSummary {
  runDate: string;
  titles: string[];
  considered: number;
  checked: number;
  verified: number;
  runUrl?: string;
}

export function renderChangelogLine(s: RunSummary): string {
  const n = s.titles.length;
  const titles = s.titles.map((t) => `"${clean(t, 90)}"`).join("; ");
  const sources = `${s.verified} of ${s.checked} cited source${s.checked === 1 ? "" : "s"} verified`;
  const link = s.runUrl ? ` [Run log](${safeUrl(s.runUrl)}).` : "";
  return `- **${s.runDate}, automated scout** — added ${n} candidate${n === 1 ? "" : "s"}: ${titles}. ${s.considered} considered; ${sources}.${link}`;
}

// Adds a line inside the scout's own marked lines, first under the Changelog heading. Other lines are untouched.
export function upsertChangelog(content: string, line: string, maxLines: number = CHANGELOG.maxLines): string {
  const start = content.indexOf(CHANGELOG.start);
  const end = content.indexOf(CHANGELOG.end);
  if (start >= 0 && end > start) {
    const prior = content
      .slice(start + CHANGELOG.start.length, end)
      .split("\n")
      .filter((l) => l.startsWith("- "));
    const block = [CHANGELOG.start, ...[line, ...prior].slice(0, maxLines), CHANGELOG.end].join("\n");
    return content.slice(0, start) + block + content.slice(end + CHANGELOG.end.length);
  }
  const block = [CHANGELOG.start, line, CHANGELOG.end].join("\n");
  const h = content.indexOf(`\n${CHANGELOG.heading}`);
  if (h < 0) return `${content.trimEnd()}\n\n${CHANGELOG.heading}\n\n${block}\n`;
  const headingEnd = content.indexOf("\n", h + 1);
  if (headingEnd < 0) return `${content.trimEnd()}\n\n${block}\n`;
  return `${content.slice(0, headingEnd)}\n\n${block}${content.slice(headingEnd)}`;
}

// Builds the next version of the scout's own list. `existing` is null before the list has been created.
export function mergeIntoScoutList(
  existing: string | null,
  newEntries: string[],
  meta: ListMeta,
  limits: { maxEntries: number; maxBytes: number },
  changelogLine?: string,
): string {
  const base =
    existing === null
      ? renderTemplate(meta)
      : existing.includes(MARKERS.start) && existing.includes(MARKERS.end)
        ? existing
        : `${existing.trimEnd()}\n\n${MARKERS.start}\n${MARKERS.end}\n`;
  let entries = [...newEntries, ...scoutedEntries(base)].slice(0, limits.maxEntries);
  const build = () => {
    const start = base.indexOf(MARKERS.start);
    const end = base.indexOf(MARKERS.end);
    const doc = base.slice(0, start) + renderBlock(entries, { ...meta, added: newEntries.length }) + base.slice(end + MARKERS.end.length);
    return changelogLine ? upsertChangelog(doc, changelogLine) : doc;
  };
  let next = build();
  while (Buffer.byteLength(next, "utf8") > limits.maxBytes && entries.length > 0) {
    entries = entries.slice(0, -1); // drop the oldest entry; it stays in version history
    next = build();
  }
  return next;
}
