import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { rateLimited } from "@/lib/rate-limit";
import { extractPage, safeFetchText, UnsafeUrlError } from "@/lib/safe-fetch";
import { summarizePage } from "@/lib/ai/studio";
import { linkRequestSchema } from "@/lib/validation/workspace";

export const maxDuration = 45;

/** Fetches a reference page server-side (SSRF-guarded) and summarises it for the brief. Brand only. */
export async function POST(request: Request) {
  const auth = await apiSession(["brand"]);
  if ("error" in auth) return auth.error;
  const parsed = linkRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid link" }, { status: 400 });
  if (rateLimited(`studio-link:${auth.session.profile.id}`, 10)) {
    return NextResponse.json({ error: "Too many requests — wait a minute." }, { status: 429 });
  }

  try {
    const page = await safeFetchText(parsed.data.url);
    const info = extractPage(page.body);
    const { summary, model } = await summarizePage({ url: page.url, ...info });
    return NextResponse.json({ url: page.url, title: info.title, description: info.description, site: info.site, summary, model });
  } catch (err) {
    const message = err instanceof UnsafeUrlError ? err.message
      : err instanceof Error && /timeout|aborted/i.test(err.message) ? "That page took too long to respond."
        : err instanceof Error ? err.message : "Couldn't read that page.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
