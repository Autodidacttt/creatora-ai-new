import { Chip } from "@/components/ui/chip";

/** 🟢 Verified · 🟡 Pending · 🔴 Rejected (or Potential Impersonation when the company contact rejected) */
export function StatusChip({ status, impersonation }: { status: string; impersonation?: boolean }) {
  if (status === "verified" || status === "approved") return <Chip tone="success">🟢 Verified</Chip>;
  if (status === "rejected") return <Chip tone="danger">{impersonation ? "🔴 Verification Rejected / Potential Impersonation" : "🔴 Rejected"}</Chip>;
  return <Chip tone="amber">🟡 Pending</Chip>;
}
