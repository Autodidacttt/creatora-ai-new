"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useMe } from "@/features/session";
import { getMyVerification } from "@/services/verification";

/**
 * Brands only. New brands: "verify to publish and hire" (enforced in the database). Existing brands are
 * grandfathered but asked to choose an account type and verify.
 */
export function VerificationBanner() {
  const me = useMe();
  const path = usePathname();
  const q = useQuery({ queryKey: ["verification", "me"], queryFn: getMyVerification, enabled: me.role === "brand", staleTime: 60_000 });
  if (me.role !== "brand" || !q.data || path.startsWith("/verification")) return null;
  const s = q.data;
  const pending = s.identity?.status === "pending" || s.company?.status === "pending";
  let text: string | null = null;
  if (!s.can_operate) text = pending ? "Your verification is under review. Publishing briefs and hiring unlock once it's approved." : "Verify your brand account to publish briefs and hire creators.";
  else if (!s.brand_type) text = "Choose your account type (Individual Recruiter or Company) and verify your brand.";
  if (!text) return null;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber/50 bg-amber-soft/70 px-4 py-3 text-sm">
      <ShieldAlert className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{text}</span>
      {!pending && <Link href="/verification" className="font-semibold underline-offset-4 hover:underline">Verify now →</Link>}
    </div>
  );
}
