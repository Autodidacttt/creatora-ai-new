"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useDb, useMe } from "@/features/session";
import { getBrandCampaigns } from "@/services/campaigns";
import { ReelsViewer } from "@/components/reels/reels-viewer";
import { Select } from "@/components/ui/field";
import { buttonVariants } from "@/components/ui/button";

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

  return (
    <div className={`flex min-h-[26rem] flex-col gap-3 ${PAGE_HEIGHT}`}>
      <div className="flex shrink-0 items-center gap-2">
        <h1 className="display mr-auto truncate text-xl sm:text-2xl">{isBrand ? "Discover creators" : "Meet creators"}</h1>
        {isBrand && campaigns.data && campaigns.data.items.length > 0 && (
          <Select aria-label="Rank by brief" value={selected ?? ""} className="h-9 w-40 rounded-full text-xs sm:w-64"
            onChange={(e) => router.replace(e.target.value ? `/swipe?campaign=${e.target.value}` : "/swipe")}>
            {campaigns.data.items.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
        )}
        <Link href="/discover" className={buttonVariants({ variant: "glass", size: "sm" })} aria-label="Search and filters">
          <Search /> <span className="hidden sm:inline">Search & filters</span>
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        {ready && <ReelsViewer key={selected ?? "none"} campaignId={isBrand ? selected : null} isBrand={isBrand} />}
      </div>
    </div>
  );
}
