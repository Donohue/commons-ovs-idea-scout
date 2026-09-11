import { LIMITS, USER_AGENT } from "./config.js";

export interface PublicResponse {
  status: number;
  url: string;
  contentType: string;
  text: string;
}

// Unauthenticated fetch for third-party pages and feeds. Never attach credentials here.
export async function fetchPublic(
  url: string,
  opts: { accept?: string; timeoutMs?: number } = {},
): Promise<PublicResponse> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: opts.accept ?? "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? LIMITS.fetchTimeoutMs),
  });
  const text = await res.text();
  return { status: res.status, url: res.url, contentType: res.headers.get("content-type") ?? "", text };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&");
}

export function htmlToText(html: string): string {
  const withoutCode = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  return decodeEntities(withoutCode.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
