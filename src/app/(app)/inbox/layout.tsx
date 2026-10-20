"use client";

import { useParams } from "next/navigation";
import { InboxList } from "@/components/chat/inbox-list";
import { cn } from "@/lib/utils";

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id?: string }>();
  return (
    <div className="glass grid h-[calc(100dvh-10.5rem)] min-h-[28rem] gap-4 rounded-[2rem] p-3 sm:p-4 lg:h-[calc(100dvh-7.5rem)] lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className={cn("min-h-0", id && "hidden lg:block")}><InboxList /></aside>
      <section className={cn("min-h-0 rounded-[1.5rem] bg-glass-strong p-3 sm:p-4", !id && "hidden lg:block")}>{children}</section>
    </div>
  );
}
