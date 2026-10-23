import type { ReactNode } from "react";
import {
  Ban, BadgeCheck, CheckCircle2, CircleDashed, CircleDollarSign, Clock3, FileCheck2, Hammer, Hourglass, Lock, RotateCcw,
  Scale, Send, Star, UserCheck, Wallet, XCircle,
} from "lucide-react";
import type { EscrowStatus, ProjectStatus, SubmissionStatus } from "@/types/workspace";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "amber" | "solid" | "dark" | "success" | "danger" | "outline";

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: Tone; icon: ReactNode; creator: string; brand: string }> = {
  applied: { label: "Applied", tone: "outline", icon: <Send />, creator: "You applied. In a sprint you can submit spec work right away.", brand: "Applied — not hired yet." },
  shortlisted: { label: "Shortlisted", tone: "amber", icon: <Star />, creator: "You're on the shortlist.", brand: "On your shortlist." },
  awaiting_funding: { label: "Awaiting funding", tone: "amber", icon: <Hourglass />, creator: "You're hired — waiting for the brand to fund the project. Work starts once it's funded.", brand: "Hired — fund the project so the creator can start." },
  hired: { label: "Hired", tone: "amber", icon: <UserCheck />, creator: "You're hired — start when you're ready.", brand: "Hired. Waiting for the creator to start." },
  in_progress: { label: "In progress", tone: "amber", icon: <Hammer />, creator: "Working on it. Submit when your first version is ready.", brand: "The creator is working on it." },
  submitted: { label: "In review", tone: "solid", icon: <FileCheck2 />, creator: "Submitted — the brand is reviewing.", brand: "Waiting for your review." },
  revision_requested: { label: "Revision requested", tone: "danger", icon: <RotateCcw />, creator: "The brand asked for changes — see the feedback and resubmit.", brand: "Waiting for the creator's revision." },
  resubmitted: { label: "Revision in review", tone: "solid", icon: <FileCheck2 />, creator: "Revised version submitted — the brand is reviewing.", brand: "A revised version is waiting for your review." },
  approved: { label: "Approved", tone: "success", icon: <BadgeCheck />, creator: "Approved! Waiting for the brand to release payment.", brand: "Approved — release payment to complete." },
  completed: { label: "Completed", tone: "dark", icon: <CheckCircle2 />, creator: "Complete and paid.", brand: "Complete — licence record issued." },
  rejected: { label: "Rejected", tone: "danger", icon: <XCircle />, creator: "The brand rejected this work.", brand: "You rejected this work." },
  cancelled: { label: "Cancelled", tone: "neutral", icon: <Ban />, creator: "This project was cancelled.", brand: "Cancelled." },
};

export const SUBMISSION_STATUS: Record<SubmissionStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  draft: { label: "Draft", tone: "outline", icon: <CircleDashed /> },
  submitted: { label: "Awaiting review", tone: "solid", icon: <Clock3 /> },
  revision_requested: { label: "Changes requested", tone: "danger", icon: <RotateCcw /> },
  approved: { label: "Approved", tone: "success", icon: <BadgeCheck /> },
  rejected: { label: "Rejected", tone: "danger", icon: <XCircle /> },
};

export const ESCROW_STATUS: Record<EscrowStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  unfunded: { label: "Pending funding", tone: "outline", icon: <Wallet /> },
  funded: { label: "Funded · in escrow", tone: "amber", icon: <Lock /> },
  released: { label: "Paid", tone: "success", icon: <CircleDollarSign /> },
  refunded: { label: "Refunded", tone: "neutral", icon: <RotateCcw /> },
  disputed: { label: "Disputed", tone: "danger", icon: <Scale /> },
};

export function ProjectStatusChip({ status, className }: { status: ProjectStatus; className?: string }) {
  const s = PROJECT_STATUS[status];
  return <Chip tone={s.tone} icon={s.icon} className={className}>{s.label}</Chip>;
}
export function SubmissionStatusChip({ status, className }: { status: SubmissionStatus; className?: string }) {
  const s = SUBMISSION_STATUS[status];
  return <Chip tone={s.tone} icon={s.icon} className={className}>{s.label}</Chip>;
}
export function EscrowChip({ status, className }: { status: EscrowStatus | null | undefined; className?: string }) {
  if (!status) return <Chip tone="outline" icon={<Wallet />} className={className}>No amount set</Chip>;
  const s = ESCROW_STATUS[status];
  return <Chip tone={s.tone} icon={s.icon} className={className}>{s.label}</Chip>;
}

/** A compact, labelled progress rail of the project lifecycle. */
const STEPS: { key: string; label: string; reached: ProjectStatus[] }[] = [
  { key: "hired", label: "Hired", reached: ["awaiting_funding", "hired", "in_progress", "submitted", "revision_requested", "resubmitted", "approved", "completed"] },
  { key: "work", label: "Working", reached: ["in_progress", "submitted", "revision_requested", "resubmitted", "approved", "completed"] },
  { key: "review", label: "In review", reached: ["submitted", "revision_requested", "resubmitted", "approved", "completed"] },
  { key: "approved", label: "Approved", reached: ["approved", "completed"] },
  { key: "paid", label: "Paid", reached: ["completed"] },
];

export function ProjectStepper({ status, hired, className }: { status: ProjectStatus; hired: boolean; className?: string }) {
  if (status === "rejected" || status === "cancelled") return null;
  return (
    <ol className={cn("flex items-center gap-1.5", className)} aria-label="Project progress">
      {STEPS.map((step, i) => {
        const done = step.reached.includes(status) && (step.key !== "hired" || hired);
        const current = done && !STEPS[i + 1]?.reached.includes(status);
        return (
          <li key={step.key} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={cn("h-1.5 rounded-full transition-colors duration-500", done ? "bg-amber" : "bg-ink/10", current && "bg-amber-2")} />
            <span className={cn("truncate text-[10px] font-medium sm:text-[11px]", done ? "text-ink" : "text-ink-3")}>
              {step.label}
              {current && <span className="sr-only"> (current)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
