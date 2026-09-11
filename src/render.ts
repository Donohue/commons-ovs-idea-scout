import { INSERT_BEFORE_HEADING, MARKERS, RUBRIC_KEYS } from "./config.js";
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
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
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

// Titles of every "### " entry in the Resource, human-written or scouted.
export function existingTitles(content: string): string[] {
  return [...content.matchAll(/^###\s+(.+)$/gm)].map((m) =>
    m[1]
      .replace(/^[A-Z]\s+[—-]\s+/, "")
      .split(" · ")[0]
      .trim(),
  );
}

// Every https URL cited anywhere in the Resource, human-written or scouted.
export function citedUrls(content: string): Set<string> {
  return new Set([...content.matchAll(/https:\/\/[^\s)\]>"'<]+/g)].map((m) => canonicalUrl(m[0].replace(/[.,;:]+$/, ""))));
}

export const isDuplicate = (title: string, existing: string[]) => existing.some((t) => similarity(title, t) >= 0.5);

// Untrusted model and page text goes into shared Markdown: flatten it and remove anything that could forge markers or markup.
export function clean(s: string, max: number): string {
  const flat = s
    .replace(/<!--|-->/g, " ")
    .replace(/idea-scout:(start|end)/gi, " ")
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
  const inner = content.slice(start + MARKERS.start.length, end);
  return inner
    .split(/^(?=### )/m)
    .filter((s) => s.startsWith("### "))
    .map((s) => s.trim());
}

export interface BlockMeta {
  runDate: string;
  handle: string;
  taskId: number;
  added: number;
  considered: number;
}

export function renderBlock(entries: string[], meta: BlockMeta): string {
  return [
    MARKERS.start,
    "## Scouted candidates (automated, unreviewed)",
    "",
    `An automated scout run by \`@${meta.handle}\` for task #${meta.taskId} adds entries here. Before anything is published, the scout opens each cited page and checks that the quote is actually on it. The scores are a model's first judgment, and nothing here is agreed. To adopt an entry, move it into the shortlist above. To pause the scout, say so in the #${meta.taskId} thread.`,
    "",
    `_Last update ${meta.runDate}: ${meta.added} added from ${meta.considered} considered. ${entries.length} shown here; older entries remain in version history._`,
    "",
    entries.join("\n\n"),
    MARKERS.end,
  ].join("\n");
}

export function mergeIntoResource(
  content: string,
  newEntries: string[],
  meta: Omit<BlockMeta, "added">,
  limits: { maxEntries: number; maxBytes: number },
): string {
  let entries = [...newEntries, ...scoutedEntries(content)].slice(0, limits.maxEntries);
  const build = () => {
    const block = renderBlock(entries, { ...meta, added: newEntries.length });
    const start = content.indexOf(MARKERS.start);
    const end = content.indexOf(MARKERS.end);
    if (start >= 0 && end > start) return content.slice(0, start) + block + content.slice(end + MARKERS.end.length);
    const at = content.indexOf(`\n${INSERT_BEFORE_HEADING}`);
    if (at >= 0) return `${content.slice(0, at)}\n\n${block}\n${content.slice(at)}`;
    return `${content.trimEnd()}\n\n${block}\n`;
  };
  let next = build();
  while (Buffer.byteLength(next, "utf8") > limits.maxBytes && entries.length > 0) {
    entries = entries.slice(0, -1); // drop the oldest scouted entry
    next = build();
  }
  return next;
}
