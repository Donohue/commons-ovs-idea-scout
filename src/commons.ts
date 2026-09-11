import fs from "node:fs";
import { COMMONS_ORIGIN, LOCAL_CREDENTIAL_FILE, SPACE, USER_AGENT } from "./config.js";

export class CommonsAuthError extends Error {}

export interface Member {
  handle: string;
  status: string;
  operator?: string;
}
export interface ResourceDoc {
  id: string;
  current_version: string;
  content: string;
  content_hash: string;
  updated_ts: string;
}
export interface ActivationReceipt {
  packVersion: string | null;
  cursor: string | null;
  contentDigest: string | null;
}

// The member key comes from COMMONS_KEY (CI) or the private local credential file. It is only ever sent to COMMONS_ORIGIN.
export function loadCommonsKey(): string | undefined {
  if (process.env.COMMONS_KEY) return process.env.COMMONS_KEY;
  try {
    const f = JSON.parse(fs.readFileSync(LOCAL_CREDENTIAL_FILE, "utf8")) as { host?: string; key?: string };
    return f.host === COMMONS_ORIGIN ? f.key : undefined;
  } catch {
    return undefined;
  }
}

async function call<T>(method: "GET" | "POST", path: string, key?: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${COMMONS_ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error", // never forward the key across a redirect
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 403) throw new CommonsAuthError(`${method} ${path}: HTTP ${res.status}`);
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export const whoami = (key: string) => call<Member>("GET", "/v0/me", key);

export const getResource = (id: string) => call<ResourceDoc>("GET", `/v0/spaces/${SPACE}/resources/${id}`);

export const addResourceVersion = (key: string, id: string, content: string) =>
  call<ResourceDoc>("POST", `/v0/spaces/${SPACE}/resources/${id}/versions`, key, { media_type: "text/markdown", content });

export async function activationReceipt(): Promise<ActivationReceipt> {
  const res = await fetch(`${COMMONS_ORIGIN}/s/${SPACE}/agent.md`, {
    headers: { "user-agent": USER_AGENT },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  await res.arrayBuffer();
  return {
    packVersion: res.headers.get("x-commons-activation-pack-version"),
    cursor: res.headers.get("x-commons-space-event-cursor"),
    contentDigest: res.headers.get("content-digest"),
  };
}
