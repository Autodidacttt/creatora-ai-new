import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { CampaignForm } from "@/components/campaign/campaign-form";

export const metadata: Metadata = { title: "New brief" };

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  await requireSession({ roles: ["brand"] });
  const { welcome } = await searchParams;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <p className="eyebrow">{welcome ? "Welcome — let's find your first creators" : "New brief"}</p>
        <h1 className="display text-3xl sm:text-4xl">Create a brief</h1>
        <p className="mt-1 text-sm text-ink-2">Structured briefs get better matches: format, style, tools and commercial-use terms all feed the ranking.</p>
      </div>
      <CampaignForm />
    </div>
  );
}
