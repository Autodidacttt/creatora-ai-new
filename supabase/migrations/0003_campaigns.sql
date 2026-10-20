-- 0003: briefs / campaigns, applications, shortlists, selections

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 140),
  description text not null check (char_length(description) between 10 and 4000),
  deliverables text check (char_length(deliverables) <= 2000),
  content_type_id int references public.content_types(id) on delete set null,
  style_id int references public.styles(id) on delete set null,
  category_id int references public.categories(id) on delete set null,
  aspect_ratios text[] not null default '{}'
    check (aspect_ratios <@ array['16:9','9:16','1:1','4:5','4:3','21:9','custom']::text[]),
  custom_aspect text check (char_length(custom_aspect) <= 40),
  target_audience text check (char_length(target_audience) <= 500),
  budget_min int check (budget_min >= 0),
  budget_max int check (budget_max >= 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  deadline date,
  creators_needed smallint not null default 1 check (creators_needed between 1 and 50),
  -- Commercial-use requirements
  usage_rights text[] not null default '{}'
    check (usage_rights <@ array['organic_social','paid_social','broadcast','ooh','web','internal']::text[]),
  territory text not null default 'worldwide' check (char_length(territory) <= 80),
  usage_duration text not null default '12_months'
    check (usage_duration in ('3_months','6_months','12_months','24_months','perpetual')),
  exclusivity text not null default 'none' check (exclusivity in ('none','category','full')),
  license_type text not null default 'non_exclusive'
    check (license_type in ('non_exclusive','exclusive','buyout','limited')),
  ai_disclosure_required boolean not null default true,
  ai_assisted boolean not null default false,          -- brief drafted with the AI brief builder
  status text not null default 'draft' check (status in ('draft','active','completed')),
  published_at timestamptz,
  search tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' ||
      coalesce(target_audience, '') || ' ' || coalesce(deliverables, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (budget_max is null or budget_min is null or budget_max >= budget_min),
  check (custom_aspect is null or 'custom' = any(aspect_ratios))
);
create index campaigns_brand_idx on public.campaigns(brand_id, created_at desc);
create index campaigns_status_idx on public.campaigns(status, deadline);
create index campaigns_search_idx on public.campaigns using gin(search);
create index campaigns_aspect_idx on public.campaigns using gin(aspect_ratios);

create table public.campaign_platforms (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  platform_id int not null references public.platforms(id) on delete cascade,
  primary key (campaign_id, platform_id)
);
create table public.campaign_tools (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  tool_id int not null references public.ai_tools(id) on delete cascade,
  primary key (campaign_id, tool_id)
);
create table public.campaign_skills (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  skill_id int not null references public.skills(id) on delete cascade,
  primary key (campaign_id, skill_id)
);
create table public.campaign_languages (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  language_id int not null references public.languages(id) on delete cascade,
  primary key (campaign_id, language_id)
);

create table public.campaign_applications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  pitch text not null check (char_length(trim(pitch)) between 10 and 1500),
  proposed_rate int check (proposed_rate >= 0),
  status text not null default 'pending' check (status in ('pending','rejected','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, creator_id)
);
create index campaign_applications_creator_idx on public.campaign_applications(creator_id);

create table public.campaign_shortlists (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid not null references public.profiles(id) on delete cascade,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  primary key (campaign_id, creator_id)
);
create index campaign_shortlists_creator_idx on public.campaign_shortlists(creator_id);

create table public.campaign_creators (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'selected' check (status in ('selected','completed')),
  created_at timestamptz not null default now(),
  primary key (campaign_id, creator_id)
);
create index campaign_creators_creator_idx on public.campaign_creators(creator_id);

create table public.saved_opportunities (
  creator_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (creator_id, campaign_id)
);

-- Computed pipeline counts. security_invoker: callers only count rows RLS lets them see,
-- so brands get exact numbers for their own campaigns.
create view public.campaign_stats with (security_invoker = true) as
select
  c.id as campaign_id,
  (select count(*) from public.campaign_applications a
     where a.campaign_id = c.id and a.status <> 'withdrawn')::int as applications_count,
  (select count(*) from public.campaign_shortlists s where s.campaign_id = c.id)::int as shortlisted_count,
  (select count(*) from public.campaign_creators x where x.campaign_id = c.id)::int as selected_count
from public.campaigns c;
