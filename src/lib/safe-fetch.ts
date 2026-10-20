import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";

// Server-side fetch of user-supplied URLs without becoming an open proxy into private networks (SSRF):
// http(s) on default ports only, every resolved address must be public, redirects re-validated hop by hop,
// bounded size and time.

function privateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return privateV4(ip);
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") ||
    v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

export class UnsafeUrlError extends Error {}

async function assertPublic(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new UnsafeUrlError("Only http(s) links are supported");
  if (url.port && !["80", "443"].includes(url.port)) throw new UnsafeUrlError("Links on custom ports aren't supported");
  if (url.username || url.password) throw new UnsafeUrlError("Links with credentials aren't supported");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new UnsafeUrlError("That address isn't reachable");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new UnsafeUrlError("That address isn't reachable");
}

export async function safeFetchText(raw: string, opts: { maxBytes?: number; timeoutMs?: number; hops?: number } = {}): Promise<{ url: string; contentType: string; body: string }> {
  const maxBytes = opts.maxBytes ?? 1_500_000;
  let url = new URL(raw);
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 9000);
  for (let hop = 0; hop <= (opts.hops ?? 3); hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: deadline,
      headers: { "user-agent": "CreatoraBot/1.0 (+brief link summaries)", accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new Error(`The page responded with ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml|text\/plain/.test(contentType)) throw new Error("That link isn't a web page");
    const reader = res.body?.getReader();
    if (!reader) return { url: url.toString(), contentType, body: "" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      chunks.push(value);
      if (size >= maxBytes) { await reader.cancel(); break; }
    }
    return { url: url.toString(), contentType, body: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)) };
  }
  throw new Error("Too many redirects");
}

const decode = (s: string) => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

/** Title, description and readable text from an HTML page (no DOM needed). */
export function extractPage(html: string) {
  const meta = (name: string) => {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i");
    const tag = re.exec(html)?.[0];
    const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
    return content ? decode(content).trim() : null;
  };
  const title = meta("og:title") ?? (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)![1]).trim() : null);
  const text = decode(html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|section|article|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return {
    title: title?.slice(0, 200) ?? null,
    description: (meta("og:description") ?? meta("description"))?.slice(0, 500) ?? null,
    site: meta("og:site_name")?.slice(0, 100) ?? null,
    text: text.slice(0, 6000),
  };
}
