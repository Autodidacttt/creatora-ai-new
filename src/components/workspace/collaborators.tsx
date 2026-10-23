"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Hourglass, ListTodo, Lock, MessagesSquare, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import type { CampaignTask, TaskStatus } from "@/types/workspace";
import { useDb, useMe } from "@/features/session";
import { createTask, deleteTask, getCollaborators, getTasks, updateTaskStatus } from "@/services/workspace";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { cn, errorMessage } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/money";
import { ProjectStatusChip } from "./status";

export const collaboratorLabel = (n: number) => (n === 0 ? "No collaborators yet" : `${n} Collaborator${n === 1 ? "" : "s"}`);

const TASK_STATUS: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", done: "Done" };

/** On each brief card: "N Collaborators" (hired, not cancelled/rejected — from campaign_stats) + "N of M hired". */
export function CollaboratorsBar({ campaign }: { campaign: { id: string; title: string; creators_needed: number; stats: { selected: number } | null } }) {
  const [open, setOpen] = useState(false);
  const n = campaign.stats?.selected ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <button type="button" onClick={() => setOpen(true)}
        className={cn("inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-card/70", n > 0 ? "font-semibold" : "text-ink-3")}>
        <Users className="size-3.5" /> {collaboratorLabel(n)}
      </button>
      <span className="text-xs text-ink-3">{n} of {campaign.creators_needed} hired</span>
      <span className="flex-1" />
      {/* The creator count is a target, not a cap */}
      <Link href={`/campaigns/${campaign.id}?tab=matches`} className="inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink">
        <Plus className="size-3.5" /> {n >= campaign.creators_needed ? "Add more creators" : "Find creators"}
      </Link>
      {open && <CollaboratorsPanel campaignId={campaign.id} title={campaign.title} open onOpenChange={setOpen} />}
    </div>
  );
}

function TaskRow({ t, canEdit, canDelete, onChanged }: { t: CampaignTask; canEdit: boolean; canDelete: boolean; onChanged: () => void }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  return (
    <li className={cn("flex flex-wrap items-center gap-2 rounded-2xl bg-card/70 p-3", t.status === "done" && "opacity-70")}>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium", t.status === "done" && "line-through")}>{t.title}</span>
        <span className="block text-[11px] text-ink-3">
          {t.scope === "group" ? "Whole group" : t.assignee?.display_name ?? "Assigned"}{t.due_date && ` · due ${formatDate(t.due_date)}`}
        </span>
        {t.description && <span className="mt-0.5 block whitespace-pre-line text-xs text-ink-2">{t.description}</span>}
      </span>
      {canEdit ? (
        <Select aria-label={`Status of ${t.title}`} value={t.status} disabled={busy} className="h-8 w-32 text-xs"
          onChange={async (e) => {
            setBusy(true);
            try { await updateTaskStatus(db, t.id, e.target.value as TaskStatus); onChanged(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
          }}>
          {Object.entries(TASK_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      ) : <Chip tone="outline">{TASK_STATUS[t.status]}</Chip>}
      {canDelete && (
        <Button size="icon-sm" variant="ghost" aria-label={`Delete ${t.title}`} loading={busy} onClick={async () => {
          setBusy(true);
          try { await deleteTask(db, t.id); onChanged(); } catch (err) { toast.error(errorMessage(err)); setBusy(false); }
        }}><Trash2 /></Button>
      )}
    </li>
  );
}

function NewTaskForm({ campaignId, members, onCreated }: { campaignId: string; members: { id: string; name: string }[]; onCreated: () => void }) {
  const db = useDb();
  const [v, setV] = useState({ title: "", description: "", due: "", assignee: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="space-y-3 rounded-2xl border border-dashed border-line p-3" onSubmit={async (e) => {
      e.preventDefault();
      if (v.title.trim().length < 3) return setError("Give the task a title (3+ characters)");
      setBusy(true);
      setError(null);
      try {
        await createTask(db, campaignId, { title: v.title.trim(), description: v.description.trim() || null, due_date: v.due || null, assigneeId: v.assignee || null });
        toast.success(v.assignee ? "Task assigned — posted in their chat" : "Group task posted in the group chat");
        setV({ title: "", description: "", due: "", assignee: v.assignee });
        onCreated();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    }}>
      <p className="text-sm font-semibold">New task</p>
      <Field label="Title" htmlFor="tk-title" error={error}>
        <Input id="tk-title" maxLength={140} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. Share the storyboard" />
      </Field>
      <Field label="Details" htmlFor="tk-desc" optional>
        <Textarea id="tk-desc" rows={2} maxLength={2000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="For" htmlFor="tk-who">
          <Select id="tk-who" value={v.assignee} onChange={(e) => setV({ ...v, assignee: e.target.value })}>
            <option value="">Whole group</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Due" htmlFor="tk-due" optional>
          <Input id="tk-due" type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} />
        </Field>
      </div>
      <div className="flex justify-end"><Button type="submit" size="sm" variant="primary" loading={busy}><ListTodo /> Assign task</Button></div>
    </form>
  );
}

/** Brand: members, their status, the group chat and tasks for one brief. */
export function CollaboratorsPanel({ campaignId, title, open, onOpenChange }: { campaignId: string; title: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const db = useDb();
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["collaborators", campaignId], queryFn: () => getCollaborators(db, campaignId), enabled: open });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["collaborators", campaignId] }); qc.invalidateQueries({ queryKey: ["tasks", campaignId] }); };
  const d = q.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Collaborators · ${title}`} size="lg"
      description={d ? `${collaboratorLabel(d.count)} · ${d.count} of ${d.campaign.creators_needed} hired` : undefined}>
      {q.isPending && <Skeleton className="h-60 rounded-2xl" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isSuccess && !d && <ErrorState error="Only the brand and its hired creators can see this." title="Not available" />}
      {d && (
        <div className="space-y-5">
          {d.awaiting_funding.length > 0 && (
            <section className="space-y-2 rounded-2xl border border-amber/50 bg-amber-soft/60 p-3" aria-label="Awaiting funding">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Hourglass className="size-4" /> Awaiting funding</h3>
              <p className="text-xs text-ink-2">Hired, but not collaborators yet: they can&apos;t start, get tasks or join the group chat until you fund the project.</p>
              <ul className="space-y-2">
                {d.awaiting_funding.map((m) => (
                  <li key={m.project_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-card/80 p-2.5">
                    <Avatar src={m.creator.avatar_url} name={m.creator.display_name} verified={m.creator.is_verified} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{m.creator.display_name}</span>
                      <span className="block text-[11px] text-ink-3">Hired {formatDate(m.hired_at)}{m.agreed_amount != null && ` · ${formatMoney(m.agreed_amount, m.currency)}`}</span>
                    </span>
                    <Link href={`/brand/campaigns/projects/${m.project_id}?fund=1`} className={buttonVariants({ size: "sm", variant: "primary" })}><Lock /> Fund project</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {d.members.length === 0 ? <EmptyState icon={<Users />} title="No collaborators yet" description="Hire creators by accepting their offers in chat, then fund the project." /> : (
            <ul className="space-y-2">
              {d.members.map((m) => (
                <li key={m.project_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-card/70 p-2.5">
                  <Avatar src={m.creator.avatar_url} name={m.creator.display_name} verified={m.creator.is_verified} />
                  <span className="min-w-0 flex-1">
                    <Link href={`/u/${m.creator.username}`} className="block truncate text-sm font-semibold hover:underline">{m.creator.display_name}</Link>
                    <span className="block text-[11px] text-ink-3">Hired {formatDate(m.hired_at)}</span>
                  </span>
                  <ProjectStatusChip status={m.status} />
                  <Link href={`/brand/campaigns/projects/${m.project_id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}><ExternalLink /> Project</Link>
                  {m.conversation_id && <Link href={`/inbox/${m.conversation_id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}><MessagesSquare /> Chat</Link>}
                </li>
              ))}
            </ul>
          )}
          {d.group_conversation_id ? (
            <Link href={`/inbox/${d.group_conversation_id}`} className={buttonVariants({ variant: "secondary" })}><MessagesSquare /> Open group chat</Link>
          ) : d.count > 0 && <p className="text-xs text-ink-3">A group chat opens automatically when a second creator is hired and funded.</p>}

          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><ListTodo className="size-4" /> Tasks</h3>
            {d.tasks.length === 0 && <p className="text-xs text-ink-3">No tasks yet.</p>}
            <ul className="space-y-2">
              {d.tasks.map((t) => <TaskRow key={t.id} t={t} canEdit canDelete={me.role === "brand"} onChanged={refresh} />)}
            </ul>
            {d.members.length > 0 && me.role === "brand" && (
              <NewTaskForm campaignId={campaignId} members={d.members.map((m) => ({ id: m.creator.id, name: m.creator.display_name }))} onCreated={refresh} />
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

/** Creator project page: their own and group tasks for the brief (status editable), plus the group chat link. */
export function CreatorTasks({ campaignId }: { campaignId: string }) {
  const db = useDb();
  const me = useMe();
  const qc = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks", campaignId], queryFn: () => getTasks(db, campaignId) });
  const collab = useQuery({ queryKey: ["collaborators", campaignId], queryFn: () => getCollaborators(db, campaignId) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["tasks", campaignId] });
  if (tasks.isPending) return <Skeleton className="h-24 rounded-2xl" />;
  if (tasks.isError) return <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />;
  return (
    <div className="space-y-3">
      {tasks.data.length === 0 ? <p className="text-sm text-ink-3">No tasks from the brand yet.</p> : (
        <ul className="space-y-2">
          {tasks.data.map((t) => <TaskRow key={t.id} t={t} canEdit={t.scope === "group" || t.assigned_to === me.id} canDelete={false} onChanged={refresh} />)}
        </ul>
      )}
      {collab.data?.group_conversation_id && (
        <Link href={`/inbox/${collab.data.group_conversation_id}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
          <MessagesSquare /> Group chat · {collaboratorLabel(collab.data.count)}
        </Link>
      )}
    </div>
  );
}
