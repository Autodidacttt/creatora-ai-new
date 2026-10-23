"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/features/session";
import { startNegotiation } from "@/services/messaging";
import { Button, type ButtonProps } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";

/**
 * Hiring starts a conversation, never a hire: it opens (or creates) the chat with this creator about this brief,
 * where both sides agree terms with offers. The hire happens only when the brand accepts the creator's final proposal.
 */
export function useStartNegotiation() {
  const db = useDb();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const start = async (campaignId: string, creatorId: string) => {
    setBusy(creatorId);
    try {
      router.push(`/inbox/${await startNegotiation(db, campaignId, creatorId)}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };
  return { start, busy };
}

export function HireButton({ campaignId, creatorId, label = "Hire", size = "sm", variant = "primary", chat = false, disabled }: {
  campaignId: string;
  creatorId: string;
  label?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  /** Show a chat icon (e.g. "Agree the fee in chat") instead of the hire icon */
  chat?: boolean;
  disabled?: boolean;
}) {
  const { start, busy } = useStartNegotiation();
  return (
    <Button size={size} variant={variant} disabled={disabled} loading={busy === creatorId} onClick={() => start(campaignId, creatorId)}
      title="Opens a chat to agree price and terms. You hire by accepting their final proposal.">
      {chat ? <MessagesSquare /> : <UserCheck />} {label}
    </Button>
  );
}
