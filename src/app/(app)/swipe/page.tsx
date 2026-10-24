"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { IdCard, Phone, Search } from "lucide-react";
import { useDb, useMe } from "@/features/session";
import { getBrandCampaigns } from "@/services/campaigns";
import { ReelsViewer } from "@/components/reels/reels-viewer";
import { Select } from "@/components/ui/field";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The app shell adds 76px above (top bar + padding) and 112px (mobile) / 48px (desktop) below.
// Sizing the page to exactly what's left means the reel frame always fits the viewport.
const PAGE_HEIGHT = "h-[calc(100dvh-188px)] lg:h-[calc(100dvh-124px)]";

export default function SwipePage() {
  const me = useMe();
  const db = useDb();
  const router = useRouter();
  const params = useSearchParams();
  const campaignParam = params.get("campaign");
  const isBrand = me.role === "brand";
  const campaigns = useQuery({
    queryKey: ["campaigns", "active"],
    queryFn: () => getBrandCampaigns(db, { status: "active" }),
    enabled: isBrand,
  });
  const selected = campaignParam ?? campaigns.data?.items[0]?.id ?? null;
  const ready = !isBrand || campaigns.isSuccess || campaigns.isError || !!campaignParam;
  // Badge filters live in the URL, like the brief selector
  const phone = params.get("phone") === "1";
  const identity = params.get("idv") === "1";
  const toggle = (key: "phone" | "idv") => {
    const p = new URLSearchParams(params);
    if (p.get(key) === "1") p.delete(key); else p.set(key, "1");
    router.replace(`/swipe${p.size ? `?${p}` : ""}`);
  };
  const pill = (on: boolean) => cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium",
    on ? "border-amber bg-amber text-on-amber" : "border-line bg-card hover:border-ink/25");

  return (
    <div className={`flex min-h-[26rem] flex-col gap-3 ${PAGE_HEIGHT}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <h1 className="display mr-auto truncate text-xl sm:text-2xl">{isBrand ? "Discover creators" : "Meet creators"}</h1>
        {isBrand && campaigns.data && campaigns.data.items.length > 0 && (
          <Select aria-label="Rank by brief" value={selected ?? ""} className="h-9 w-40 rounded-full text-xs sm:w-64"
            onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set("campaign", e.target.value); else p.delete("campaign"); router.replace(`/swipe?${p}`); }}>
            {campaigns.data.items.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
        )}
        <button type="button" aria-pressed={phone} onClick={() => toggle("phone")} className={pill(phone)} title="Only Phone Verified creators">
          <Phone className="size-3.5" /> <span className="hidden sm:inline">Phone verified</span>
        </button>
        <button type="button" aria-pressed={identity} onClick={() => toggle("idv")} className={pill(identity)} title="Only Identity Verified creators">
          <IdCard className="size-3.5" /> <span className="hidden sm:inline">Identity verified</span>
        </button>
        <Link href="/discover" className={buttonVariants({ variant: "glass", size: "sm" })} aria-label="Search and filters">
          <Search /> <span className="hidden sm:inline">Search & filters</span>
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        {ready && <ReelsViewer key={`${selected ?? "none"}-${phone}-${identity}`} campaignId={isBrand ? selected : null} isBrand={isBrand} badges={{ phone, identity }} />}
      </div>
    </div>
  );
}
