// Fetches the page a research/import item CITES and checks it — "confirmed" is only trustworthy if the
// cited page exists and actually concerns the target model. Live batch findings (2026-09-19): a
// "confirmed" Raptor complaint cited a generic 12365auto listing URL, a "confirmed" Tiggo 8 Pro item cited
// a brand-level hub page, and the manual importer accepted Google-redirect and non-existent URLs as-is.
//
// Policy per item (worst case wins across a multi-URL item, best status wins across its URLs):
//   verified           page fetched and names the target model            -> unchanged
//   no_target_mention  page fetched, doesn't name the model (hub/listing)  -> "confirmed" downgraded + warning
//   unverifiable       blocked/timeout/JS shell/non-HTML                   -> "confirmed" downgraded (we never saw it)
//   broken             404/410, DNS failure                                -> item REMOVED (dead link)
// Nothing is ever upgraded, and a page we can't read never counts as evidence against an item beyond the
// downgrade. Reddit/Dongchedi-style client-rendered pages will often land in "unverifiable" — that only
// costs the "confirmed" label, which is the intent: confirmed means we saw it.

import { isRedirectWrapper, normalizeSourceUrl, pageMentionsTarget } from "@/lib/categoryValidators";
import type { TargetModel } from "@/lib/categoryValidators";

export type SourceStatus = "verified" | "no_target_mention" | "unverifiable" | "broken";

export interface SourceCheck {
  url: string;
  /** Where the fetch ended up after redirects, when different. */
  finalUrl?: string;
  status: SourceStatus;
  httpStatus?: number;
  note: string;
}

export interface VerifyOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  concurrency?: number;
  /** Shared across calls in one run so a URL cited by many items is fetched once. */
  cache?: Map<string, Promise<SourceCheck>>;
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MIN_TEXT_CHARS = 200;

function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const headerCharset = contentType?.match(/charset=([\w-]+)/i)?.[1];
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const metaCharset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  for (const label of [headerCharset, metaCharset, "utf-8"]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      /* unknown label — try the next */
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function visibleText(html: string): { title: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return { title, text };
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(total, maxBytes));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - o);
    out.set(c.subarray(0, take), o);
    o += take;
    if (o >= out.length) break;
  }
  return out;
}

async function checkSourceOnce(url: string, target: TargetModel, opts: VerifyOptions = {}): Promise<SourceCheck> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  try {
    let res: Response;
    try {
      res = await doFetch(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "accept-language": "en,zh-CN;q=0.8,fr;q=0.5" } });
    } catch (err) {
      const e = err as { name?: string; cause?: { code?: string } };
      const code = e.cause?.code;
      if (e.name === "AbortError") return { url, status: "unverifiable", note: "timed out" };
      if (code === "ENOTFOUND" || code === "ECONNREFUSED") return { url, status: "broken", note: `host unreachable (${code})` };
      return { url, status: "unverifiable", note: `fetch failed${code ? ` (${code})` : ""}` };
    }
    const finalUrl = res.url && res.url !== url ? res.url : undefined;
    const httpStatus = res.status;
    if (httpStatus === 404 || httpStatus === 410) return { url, finalUrl, httpStatus, status: "broken", note: `HTTP ${httpStatus} — page does not exist` };
    if (httpStatus >= 400) return { url, finalUrl, httpStatus, status: "unverifiable", note: `HTTP ${httpStatus} — blocked or erroring, page not seen` };

    const contentType = res.headers.get("content-type");
    if (contentType && !/html|text|xml/i.test(contentType)) return { url, finalUrl, httpStatus, status: "unverifiable", note: `non-HTML content (${contentType.split(";")[0]})` };

    const bytes = await readCapped(res, opts.maxBytes ?? 700_000);
    const { title, text } = visibleText(decodeBody(bytes, contentType));
    if (text.length < MIN_TEXT_CHARS) return { url, finalUrl, httpStatus, status: "unverifiable", note: "page has almost no server-rendered text (JS app or bot wall)" };
    return pageMentionsTarget(`${title} ${text}`, target)
      ? { url, finalUrl, httpStatus, status: "verified", note: "page names the model" }
      : { url, finalUrl, httpStatus, status: "no_target_mention", note: "page does not mention the model — hub/listing or unrelated page?" };
  } finally {
    clearTimeout(timer);
  }
}

/** Slow Chinese sites routinely need >12s from here (a real 100KB 12365auto page timed out once, then loaded fine): retry timeouts ONCE with a longer budget before giving up. */
const TRANSIENT_NOTE = /timed out|ETIMEDOUT|CONNECT_TIMEOUT|ECONNRESET|EAI_AGAIN/;
export async function checkSource(url: string, target: TargetModel, opts: VerifyOptions = {}): Promise<SourceCheck> {
  const first = await checkSourceOnce(url, target, opts);
  if (first.status === "unverifiable" && TRANSIENT_NOTE.test(first.note)) {
    const second = await checkSourceOnce(url, target, { ...opts, timeoutMs: (opts.timeoutMs ?? 20000) * 2 });
    return second.status === "unverifiable" ? { ...second, note: `${second.note} (after retry)` } : second;
  }
  return first;
}

const RANK: Record<SourceStatus, number> = { verified: 3, no_target_mention: 2, unverifiable: 1, broken: 0 };

async function pool<A, B>(xs: A[], limit: number, fn: (x: A) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(xs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, xs.length) }, async () => {
      while (next < xs.length) {
        const i = next++;
        out[i] = await fn(xs[i]);
      }
    })
  );
  return out;
}

export interface VerifyResult<T> {
  items: T[];
  removed: { item: T; reason: string }[];
  warnings: string[];
  checks: SourceCheck[];
}

const desc = (it: unknown) => String((it as { issue_description?: unknown }).issue_description ?? "").replace(/\s+/g, " ").slice(0, 90);

/** Applies the policy above to every item that has a source_url. Mutates confidence/source_url on the item objects; returns the survivors. */
export async function verifyItemSources<T extends object>(items: T[], target: TargetModel, opts: VerifyOptions = {}): Promise<VerifyResult<T>> {
  const cache = opts.cache ?? new Map<string, Promise<SourceCheck>>();
  const urlsOf = (it: T) => normalizeSourceUrl((it as { source_url?: unknown }).source_url).all;
  const unique = [...new Set(items.flatMap(urlsOf))];
  const checkOf = (u: string) => {
    if (!cache.has(u)) cache.set(u, checkSource(u, target, opts));
    return cache.get(u)!;
  };
  const checks = await pool(unique, opts.concurrency ?? 4, checkOf);
  const byUrl = new Map(checks.map((c) => [c.url, c]));

  const survivors: T[] = [];
  const removed: { item: T; reason: string }[] = [];
  const warnings: string[] = [];
  for (const item of items) {
    const rec = item as { source_url?: string; confidence?: string };
    const urls = urlsOf(item);
    if (urls.length === 0) {
      survivors.push(item);
      continue;
    }
    const cs = urls.map((u) => byUrl.get(u)!);
    const best = cs.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a));
    // A redirect wrapper's real page is only known after following it — store that instead.
    if (best.finalUrl && isRedirectWrapper(best.url)) rec.source_url = best.finalUrl;
    if (best.status === "broken") {
      removed.push({ item, reason: `dead link: ${best.note} [${best.url}]` });
      continue;
    }
    if (best.status === "no_target_mention") {
      if (rec.confidence === "confirmed") rec.confidence = "unconfirmed";
      warnings.push(`Cited page doesn't mention the model (${best.note}) — kept as unconfirmed: "${desc(item)}" [${best.url}]`);
    } else if (best.status === "unverifiable" && rec.confidence === "confirmed") {
      rec.confidence = "unconfirmed";
      warnings.push(`Cited page couldn't be verified (${best.note}) — "confirmed" downgraded: "${desc(item)}" [${best.url}]`);
    }
    survivors.push(item);
  }
  return { items: survivors, removed, warnings, checks };
}
