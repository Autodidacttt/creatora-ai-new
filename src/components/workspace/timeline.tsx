import type { ReactNode } from "react";
import { Award, CircleDollarSign, Lock, MessageSquare, RotateCcw, Scale } from "lucide-react";
import type { ProjectEvent, ProjectStatus } from "@/types/workspace";
import { formatDateTime } from "@/lib/money";
import { PROJECT_STATUS } from "./status";

function describe(e: ProjectEvent): { icon: ReactNode; text: string } {
  const who = e.actor?.display_name ?? "Creatora";
  const d = e.data as Record<string, string | number | undefined>;
  if (e.kind === "payment") {
    const amount = d.amount_label ? ` · ${d.amount_label}` : "";
    switch (e.event) {
      case "funded": return { icon: <Lock />, text: `${who} funded escrow${amount} (test mode)` };
      case "released": return { icon: <CircleDollarSign />, text: `Payment released${amount} (test mode)` };
      case "refunded": return { icon: <RotateCcw />, text: `Escrow refunded${amount}` };
      case "disputed": return { icon: <Scale />, text: `${who} opened a dispute` };
      default: return { icon: <CircleDollarSign />, text: `Payment update: ${e.event}` };
    }
  }
  if (e.kind === "certificate") return { icon: <Award />, text: `Licence record ${d.certificate_id ?? ""} issued` };
  if (e.kind === "comment") return { icon: <MessageSquare />, text: `${who} commented` };
  const s = PROJECT_STATUS[e.event as ProjectStatus];
  const version = d.version ? ` · v${d.version}` : "";
  const amount = e.event === "hired" && d.amount_label ? ` · ${d.amount_label}` : "";
  return { icon: s?.icon ?? <MessageSquare />, text: `${s?.label ?? e.event}${version}${amount} — ${who}` };
}

export function Timeline({ events }: { events: ProjectEvent[] }) {
  if (!events.length) return <p className="text-sm text-ink-2">No activity yet.</p>;
  return (
    <ol className="relative space-y-3 before:absolute before:left-[15px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-line">
      {events.map((e) => {
        const { icon, text } = describe(e);
        return (
          <li key={e.id} className="relative flex gap-3">
            <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full border border-line bg-card text-ink-2 [&_svg]:size-4">{icon}</span>
            <div className="min-w-0 pt-1">
              <p className="text-sm">{text}</p>
              {e.note && <p className="mt-1 whitespace-pre-line rounded-xl bg-ink/[0.04] px-3 py-2 text-xs text-ink-2">{e.note}</p>}
              <p className="mt-0.5 text-[11px] text-ink-3">{formatDateTime(e.created_at)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
