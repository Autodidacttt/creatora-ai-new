import Link from "next/link";
import { BadgeCheck, ExternalLink, Workflow } from "lucide-react";
import type { FullProfile } from "@/types/app";
import { Chip } from "@/components/ui/chip";
import { money } from "@/lib/utils";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="eyebrow mb-2">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Specialisation, tools (with proficiency + verified tick), skills, formats, languages, rates. */
export function CreatorAttributes({ profile }: { profile: FullProfile }) {
  const c = profile.creator;
  const discover = (key: string, id: number) => `/discover?${key}=${id}`;
  return (
    <section aria-label="Skills and tools" className="glass space-y-5 rounded-[2rem] p-5">
      {profile.categories.length > 0 && (
        <Group title="Specialisation">
          {profile.categories.map((x) => (
            <Link key={x.id} href={discover("categories", x.id)}><Chip tone="solid">{x.name}</Chip></Link>
          ))}
        </Group>
      )}
      <Group title="AI tools & models">
        {profile.tools.length === 0 && <span className="text-sm text-ink-3">No tools listed yet</span>}
        {profile.tools.map((t) => (
          <Link key={t.id} href={discover("tools", t.id)}>
            <Chip tone="glass">
              {t.name}
              {t.proficiency && <span className="text-ink-3">· {t.proficiency}</span>}
            </Chip>
          </Link>
        ))}
      </Group>
      {profile.skills.length > 0 && (
        <Group title="Skills">
          {profile.skills.map((x) => <Link key={x.id} href={discover("skills", x.id)}><Chip>{x.name}</Chip></Link>)}
        </Group>
      )}
      {profile.content_types.length > 0 && (
        <Group title="Content types">{profile.content_types.map((x) => <Chip key={x.id} tone="outline">{x.name}</Chip>)}</Group>
      )}
      {profile.styles.length > 0 && (
        <Group title="Styles">{profile.styles.map((x) => <Chip key={x.id} tone="outline">{x.name}</Chip>)}</Group>
      )}
      <div className="grid grid-cols-2 gap-3 text-sm">
        {profile.languages.length > 0 && (
          <div><p className="eyebrow mb-1">Languages</p><p>{profile.languages.map((l) => l.name).join(", ")}</p></div>
        )}
        {profile.platforms.length > 0 && (
          <div><p className="eyebrow mb-1">Platforms</p><p>{profile.platforms.map((l) => l.name).join(", ")}</p></div>
        )}
        {c && (c.rate_min != null || c.rate_max != null) && (
          <div><p className="eyebrow mb-1">Project rate</p><p>{money(c.rate_min, c.rate_max, c.currency)}</p></div>
        )}
        {c?.years_experience != null && (
          <div><p className="eyebrow mb-1">Experience</p><p>{c.years_experience} years</p></div>
        )}
      </div>
    </section>
  );
}

export function WorkflowOverview({ text }: { text: string }) {
  return (
    <section aria-labelledby="wf-overview" className="glass rounded-[2rem] p-5">
      <h2 id="wf-overview" className="display mb-2 flex items-center gap-2 text-lg"><Workflow className="size-5 text-amber-ink" /> How I work</h2>
      <p className="whitespace-pre-line text-sm leading-relaxed text-ink-2">{text}</p>
    </section>
  );
}

export function ExperienceList({ profile }: { profile: FullProfile }) {
  if (!profile.experiences.length) return null;
  return (
    <section aria-labelledby="exp-h" className="glass rounded-[2rem] p-5">
      <h2 id="exp-h" className="display mb-3 text-lg">Brand & campaign experience</h2>
      <ul className="space-y-3">
        {profile.experiences.map((x) => (
          <li key={x.id} className="rounded-2xl bg-card p-3.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">{x.brand_name}</p>
              {x.year && <span className="text-xs text-ink-3">{x.year}</span>}
            </div>
            <p className="text-sm">{x.project_title}</p>
            {x.description && <p className="mt-1 text-xs text-ink-2">{x.description}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {x.verified && <Chip tone="amber" icon={<BadgeCheck />}>Verified collaboration</Chip>}
              {x.link && (
                <a href={x.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline">
                  View <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
