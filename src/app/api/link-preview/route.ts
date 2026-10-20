import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";

// oEmbed lookups for pasted portfolio links. Only allow-listed providers are fetched (no open proxy / SSRF).
const PROVIDERS: { test: RegExp; endpoint: (url: string) => string }[] = [
  { test: /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//, endpoint: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}` },
  { test: /^https:\/\/(www\.|player\.)?vimeo\.com\//, endpoint: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}` },
  { test: /^https:\/\/(www\.)?tiktok\.com\//, endpoint: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}` },
];

export async function GET(request: Request) {
  const auth = await apiSession();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url).searchParams.get("url") ?? "";
  const provider = PROVIDERS.find((p) => p.test.test(url));
  if (!provider) return NextResponse.json({ title: null, thumbnail_url: null });

  try {
    const res = await fetch(provider.endpoint(url), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return NextResponse.json({ title: null, thumbnail_url: null });
    const data = (await res.json()) as { title?: string; thumbnail_url?: string };
    return NextResponse.json({ title: data.title ?? null, thumbnail_url: data.thumbnail_url ?? null });
  } catch {
    return NextResponse.json({ title: null, thumbnail_url: null });
  }
}
