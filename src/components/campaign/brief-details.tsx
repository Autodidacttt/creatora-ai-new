import { BadgeCheck, CalendarDays, Clock, Globe2, Layers, Scale, ShieldAlert, Target, Users } from "lucide-react";
import type { CampaignCard } from "@/types/app";
import { EXCLUSIVITY, LICENSE_TYPES, USAGE_DURATIONS, USAGE_RIGHTS, labelOf } from "@/config/constants";
import { Chip } from "@/components/ui/chip";
import { GlassPanel } from "@/components/ui/glass";
import { money } from "@/lib/utils";

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl bg-card p-3.5">
      <span className="mt-0.5 text-ink-3 [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-ink-3">{label}</p>
        <div className="text-sm font-medium">{children}</div>
      </div>
    </div>
  );
}

/** Full structured brief, including commercial-use terms. */
export function BriefDetails({ campaign: c }: { campaign: CampaignCard }) {
  return (
    <div className="space-y-4">
      <GlassPanel className="p-5 sm:p-7">
        <h2 className="eyebrow mb-2">Brief</h2>
        <p className="whitespace-pre-line text-sm leading-relaxed">{c.description}</p>
        {c.deliverables && (
          <>
            <h3 className="eyebrow mb-2 mt-5">Deliverables</h3>
            <p className="whitespace-pre-line text-sm leading-relaxed">{c.deliverables}</p>
          </>
        )}
      </GlassPanel>

      <GlassPanel className="p-5 sm:p-7">
        <h2 className="display mb-3 text-lg">Creative & format</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Row icon={<Layers />} label="Content type">{c.content_type?.name ?? "Open"}</Row>
          <Row icon={<Layers />} label="Style / genre">{c.style?.name ?? "Open"}{c.category && ` · ${c.category.name}`}</Row>
          <Row icon={<Layers />} label="Formats">
            <span className="flex flex-wrap gap-1">{c.aspect_ratios.map((a) => <Chip key={a} tone="solid">{a === "custom" ? c.custom_aspect : a}</Chip>)}</span>
          </Row>
          <Row icon={<Globe2 />} label="Platforms">{c.platforms.map((p) => p.name).join(", ") || "Open"}</Row>
          <Row icon={<Target />} label="Target audience">{c.target_audience || "Not specified"}</Row>
          <Row icon={<Users />} label="Creators needed">{c.creators_needed}</Row>
        </div>
        <h3 className="eyebrow mb-2 mt-5">Required tools & skills</h3>
        <div className="flex flex-wrap gap-1.5">
          {c.tools.map((t) => <Chip key={t.id} tone="glass">{t.name}</Chip>)}
          {c.skills.map((s) => <Chip key={s.id}>{s.name}</Chip>)}
          {c.languages.map((l) => <Chip key={l.id} tone="outline">{l.name}</Chip>)}
          {!c.tools.length && !c.skills.length && !c.languages.length && <span className="text-sm text-ink-3">No specific requirements</span>}
        </div>
      </GlassPanel>

      <GlassPanel className="p-5 sm:p-7">
        <h2 className="display mb-3 flex items-center gap-2 text-lg"><Scale className="size-5 text-amber-2" /> Commercial use & rights</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Row icon={<BadgeCheck />} label="Usage rights">{c.usage_rights.map((u) => labelOf(USAGE_RIGHTS, u)).join(", ") || "To be agreed"}</Row>
          <Row icon={<Globe2 />} label="Territory">{c.territory}</Row>
          <Row icon={<Clock />} label="Duration">{labelOf(USAGE_DURATIONS, c.usage_duration)}</Row>
          <Row icon={<ShieldAlert />} label="Exclusivity">{labelOf(EXCLUSIVITY, c.exclusivity)}</Row>
          <Row icon={<Scale />} label="Licence">{labelOf(LICENSE_TYPES, c.license_type)}</Row>
          <Row icon={<BadgeCheck />} label="AI disclosure">{c.ai_disclosure_required ? "Required on deliverables" : "Not required"}</Row>
        </div>
      </GlassPanel>

      <GlassPanel className="p-5 sm:p-7">
        <div className="grid gap-2 sm:grid-cols-2">
          <Row icon={<Target />} label="Budget">{money(c.budget_min, c.budget_max, c.currency)}</Row>
          <Row icon={<CalendarDays />} label="Deadline">{c.deadline ? new Date(`${c.deadline}T00:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" }) : "Flexible"}</Row>
        </div>
      </GlassPanel>
    </div>
  );
}
