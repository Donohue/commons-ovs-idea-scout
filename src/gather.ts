import { GDELT_QUERIES, HN_QUERIES, LIMITS, RSS_FEEDS } from "./config.js";
import { decodeEntities, fetchPublic, sleep } from "./http.js";

// A lead for the scout. Everything in it comes from third parties and is untrusted.
export interface Signal {
  source: string;
  title: string;
  url: string;
  date: string;
  snippet: string;
}

export interface GatherResult {
  signals: Signal[];
  counts: Record<string, number>;
  errors: string[];
}

const plain = (s: string) => decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

export function parseFeed(xml: string, source: string, sinceMs: number): Signal[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const out: Signal[] = [];
  for (const b of blocks) {
    const title = plain(tag(b, "title"));
    const link = plain(tag(b, "link")) || (b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "");
    const dateRaw = plain(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const t = Date.parse(dateRaw);
    if (!title || !link.startsWith("https://")) continue;
    if (Number.isFinite(t) && t < sinceMs) continue;
    const body = tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content");
    out.push({
      source,
      title,
      url: link,
      date: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "unknown",
      snippet: plain(body).slice(0, 280),
    });
  }
  return out;
}

async function gatherFeeds(sinceMs: number, errors: string[]): Promise<Signal[]> {
  const perFeed = await Promise.all(
    RSS_FEEDS.map(async (f) => {
      try {
        const r = await fetchPublic(f.url, { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
        if (r.status !== 200) {
          errors.push(`${f.name}: HTTP ${r.status}`);
          return [];
        }
        return parseFeed(r.text, f.name, sinceMs);
      } catch (e) {
        errors.push(`${f.name}: ${(e as Error).message}`);
        return [];
      }
    }),
  );
  return perFeed.flat();
}

interface HnHit {
  objectID: string;
  title?: string;
  created_at: string;
  points?: number;
  story_text?: string;
  url?: string;
}

async function gatherHackerNews(sinceSec: number, errors: string[]): Promise<Signal[]> {
  const queries: Array<{ query?: string; tags: string; minPoints: number }> = [
    { tags: "ask_hn", minPoints: 30 },
    ...HN_QUERIES.map((q) => ({ query: `"${q}"`, tags: "story", minPoints: 5 })),
  ];
  const out: Signal[] = [];
  for (const q of queries) {
    const params = new URLSearchParams({
      tags: q.tags,
      hitsPerPage: "15",
      numericFilters: `created_at_i>${sinceSec},points>${q.minPoints}`,
    });
    if (q.query) params.set("query", q.query);
    const label = q.query ?? q.tags;
    try {
      const r = await fetchPublic(`https://hn.algolia.com/api/v1/search_by_date?${params}`, { accept: "application/json" });
      if (r.status !== 200) {
        errors.push(`Hacker News ${label}: HTTP ${r.status}`);
        continue;
      }
      const { hits } = JSON.parse(r.text) as { hits: HnHit[] };
      for (const h of hits) {
        if (!h.title) continue;
        out.push({
          source: `Hacker News (${h.points ?? 0} points)`,
          title: h.title,
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          date: h.created_at.slice(0, 10),
          snippet: plain(h.story_text ?? h.url ?? "").slice(0, 280),
        });
      }
    } catch (e) {
      errors.push(`Hacker News ${label}: ${(e as Error).message}`);
    }
  }
  return out;
}

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
}

async function gatherGdelt(errors: string[]): Promise<Signal[]> {
  const out: Signal[] = [];
  for (const [i, q] of GDELT_QUERIES.entries()) {
    if (i > 0) await sleep(5_500); // GDELT asks for at most one request every 5 seconds.
    const params = new URLSearchParams({
      query: `${q} sourcelang:english`,
      mode: "artlist",
      maxrecords: "10",
      format: "json",
      timespan: `${LIMITS.signalLookbackDays}d`,
      sort: "hybridrel",
    });
    try {
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;
      let r = await fetchPublic(url, { accept: "application/json", timeoutMs: 30_000 });
      if (r.status === 429) {
        await sleep(15_000); // rate limited: back off once, then give up on this query
        r = await fetchPublic(url, { accept: "application/json", timeoutMs: 30_000 });
      }
      if (r.status !== 200) {
        errors.push(`GDELT ${q}: HTTP ${r.status}`);
        continue;
      }
      const { articles = [] } = JSON.parse(r.text) as { articles?: GdeltArticle[] };
      for (const a of articles) {
        if (!a.url.startsWith("https://")) continue;
        const d = a.seendate;
        out.push({
          source: `News via GDELT (${a.domain})`,
          title: plain(a.title),
          url: a.url,
          date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
          snippet: "",
        });
      }
    } catch (e) {
      errors.push(`GDELT ${q}: ${(e as Error).message}`);
    }
  }
  return out;
}

function newestFirst(list: Signal[]): Signal[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, LIMITS.maxSignalsPerFamily);
}

export async function gather(now = new Date()): Promise<GatherResult> {
  const errors: string[] = [];
  const sinceMs = now.getTime() - LIMITS.signalLookbackDays * 86_400_000;
  const [feeds, hn, gdelt] = await Promise.all([
    gatherFeeds(sinceMs, errors),
    gatherHackerNews(Math.floor(sinceMs / 1000), errors),
    gatherGdelt(errors),
  ]);
  const families = { feeds: newestFirst(feeds), hackerNews: newestFirst(hn), news: newestFirst(gdelt) };
  const seen = new Set<string>();
  const signals: Signal[] = [];
  for (const s of [...families.feeds, ...families.hackerNews, ...families.news]) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    signals.push(s);
  }
  const counts = Object.fromEntries(Object.entries(families).map(([k, v]) => [k, v.length]));
  return { signals, counts, errors };
}
