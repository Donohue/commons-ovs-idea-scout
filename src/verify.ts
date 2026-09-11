import { fetchPublic, htmlToText } from "./http.js";
import type { Evidence } from "./schema.js";

export interface EvidenceCheck {
  url: string;
  ok: boolean;
  reason: string;
  match?: "exact" | "fuzzy";
  checkedAt: string;
}

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}

export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) => s.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

// Exact match after normalization, or at least 80% of the quote's five-word runs appear on the page.
export function quoteFound(quote: string, pageText: string): "exact" | "fuzzy" | null {
  const q = normalize(quote).replace(/^["'\s.]+|["'\s.]+$/g, "");
  const page = normalize(pageText);
  if (q.length >= 12 && page.includes(q)) return "exact";
  const qw = words(q);
  if (qw.length < 8) return null;
  const pageWords = ` ${words(page).join(" ")} `;
  const runs: string[] = [];
  for (let i = 0; i + 5 <= qw.length; i++) runs.push(qw.slice(i, i + 5).join(" "));
  const hits = runs.filter((r) => pageWords.includes(` ${r} `)).length;
  return hits / runs.length >= 0.8 ? "fuzzy" : null;
}

export async function verifyEvidence(e: Evidence, allowedUrls: Set<string>, now = new Date()): Promise<EvidenceCheck> {
  const checkedAt = now.toISOString();
  const fail = (reason: string): EvidenceCheck => ({ url: e.url, ok: false, reason, checkedAt });
  let parsed: URL;
  try {
    parsed = new URL(e.url);
  } catch {
    return fail("invalid URL");
  }
  if (parsed.protocol !== "https:") return fail("not https");
  if (!allowedUrls.has(canonicalUrl(e.url))) return fail("URL did not appear in this run's search, fetch, or lead results");
  try {
    const r = await fetchPublic(e.url, { accept: "text/html, text/plain, application/xhtml+xml, application/xml" });
    if (r.status < 200 || r.status >= 300) return fail(`HTTP ${r.status}`);
    const ct = r.contentType.toLowerCase();
    if (!/html|text|xml|json/.test(ct)) return fail(`unsupported content type ${ct || "unknown"}`);
    const text = /html|xml/.test(ct) ? htmlToText(r.text) : r.text;
    const match = quoteFound(e.quote, text);
    if (!match) return fail("quote not found on the page");
    return { url: e.url, ok: true, reason: "quote found", match, checkedAt };
  } catch (err) {
    return fail(`fetch failed: ${(err as Error).message}`);
  }
}
