"use client";

import { useParams } from "next/navigation";
import { Thread } from "@/components/chat/thread";

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  return <Thread key={id} conversationId={id} />;
}
