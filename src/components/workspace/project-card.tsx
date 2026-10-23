import Link from "next/link";
import { ArrowUpRight, CalendarClock } from "lucide-react";
import type { ProjectSummary } from "@/types/workspace";
import { Avatar } from "@/components/ui/avatar";
import { formatDate, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Countdown } from "./countdown";
import { EscrowChip, PROJECT_STATUS, ProjectStatusChip, ProjectStepper } from "./status";

/** One project in a list — creator ("My projects") or brand ("Active delivery"). */
export function ProjectCard({ p, view, href, className }: { p: ProjectSummary; view: "creator" | "brand"; href: string; className?: string }) {
  const other = view === "creator" ? p.campaign.brand : p.creator;
  const sprintOpen = p.campaign.is_sprint && p.campaign.sprint_deadline && !p.campaign.sprint_closed;
  const needsMe = view === "creator" ? p.status === "revision_requested" || p.status === "hired" : ["awaiting_funding", "submitted", "resubmitted", "approved"].includes(p.status);
  return (
    <Link href={href} className={cn("glass group block rounded-[1.75rem] p-4 transition-all hover:-translate-y-0.5 hover:shadow-lift sm:p-5", needsMe && "ring-2 ring-amber/60", className)}>
      <div className="flex items-start gap-3">
        <Avatar src={other.avatar_url} name={other.display_name} size="md" verified={other.is_verified} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{p.campaign.title}</p>
          <p className="truncate text-xs text-ink-2">{view === "creator" ? (other.company_name ?? other.display_name) : `@${other.username}`}</p>
        </div>
        <ArrowUpRight className="size-4 shrink-0 text-ink-3 transition-transform group-hover:rotate-45" aria-hidden />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <ProjectStatusChip status={p.status} />
        {p.campaign.is_sprint && <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bg">Sprint</span>}
        {p.escrow && <EscrowChip status={p.escrow.status} />}
      </div>
      <ProjectStepper status={p.status} hired={!!p.hired_at} className="mt-4" />
      <p className="mt-3 text-xs text-ink-2">{PROJECT_STATUS[p.status][view]}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs">
        <span className="font-semibold tabular-nums">{p.agreed_amount != null ? formatMoney(p.agreed_amount, p.currency) : "Amount not set"}</span>
        {sprintOpen ? <Countdown to={p.campaign.sprint_deadline!} compact /> : p.campaign.deadline ? (
          <span className="inline-flex items-center gap-1 text-ink-3"><CalendarClock className="size-3.5" aria-hidden /> Due {formatDate(p.campaign.deadline)}</span>
        ) : null}
        {p.latest_submission && <span className="text-ink-3">v{p.latest_submission.version}</span>}
      </div>
    </Link>
  );
}
