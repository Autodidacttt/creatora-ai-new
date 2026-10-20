-- 0016: Brand workspace schema — brand guidelines, studio/sprint fields on campaigns, the project
-- state machine on campaign_creators, submissions + files + reviews + comments, AI review results,
-- the internal escrow ledger, IP certificates, project timeline/reviews, private storage buckets and RLS.
-- Workflow RPCs live in 0017; patches to earlier read models live in 0018.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Small immutable validators (usable in check constraints)
-- ---------------------------------------------------------------------------
create or replace function public.is_hex_colors(p text[])
returns boolean language sql immutable as $$
  select coalesce(bool_and(c ~ '^#[0-9a-fA-F]{6}$'), true) from unnest(p) c;
$$;

create or replace function public.short_texts(p text[], p_max int)
returns boolean language sql immutable as $$
  select coalesce(bool_and(char_length(trim(t)) between 1 and p_max), true) from unnest(p) t;
$$;

-- ---------------------------------------------------------------------------
-- Brand guidelines ("Brand DNA"), reusable across campaigns
-- ---------------------------------------------------------------------------
create table public.brand_guidelines (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Brand guidelines' check (char_length(trim(name)) between 1 and 80),
  logo_url text check (char_length(logo_url) <= 1000),
  primary_colors text[] not null default '{}' check (cardinality(primary_colors) <= 8 and public.is_hex_colors(primary_colors)),
  secondary_colors text[] not null default '{}' check (cardinality(secondary_colors) <= 8 and public.is_hex_colors(secondary_colors)),
  fonts text[] not null default '{}' check (cardinality(fonts) <= 6 and public.short_texts(fonts, 60)),
  tone_of_voice text check (char_length(tone_of_voice) <= 1000),
  visual_style text check (char_length(visual_style) <= 2000),
  dos text[] not null default '{}' check (cardinality(dos) <= 12 and public.short_texts(dos, 200)),
  donts text[] not null default '{}' check (cardinality(donts) <= 12 and public.short_texts(donts, 200)),
  restricted_content text check (char_length(restricted_content) <= 1000),
  version int not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index brand_guidelines_brand_idx on public.brand_guidelines(brand_id, updated_at desc);

-- Every content edit bumps the version, so a campaign/certificate can say which guidelines applied.
create or replace function public.tg_guidelines_version()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if (new.logo_url, new.primary_colors, new.secondary_colors, new.fonts, new.tone_of_voice, new.visual_style,
      new.dos, new.donts, new.restricted_content, new.name)
     is distinct from
     (old.logo_url, old.primary_colors, old.secondary_colors, old.fonts, old.tone_of_voice, old.visual_style,
      old.dos, old.donts, old.restricted_content, old.name) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;
create trigger brand_guidelines_version before update on public.brand_guidelines
  for each row execute function public.tg_guidelines_version();

-- ---------------------------------------------------------------------------
-- Campaign Studio + sprint fields
-- ---------------------------------------------------------------------------
alter table public.campaigns
  add column source_idea text check (char_length(source_idea) <= 4000),
  add column source_url text check (source_url ~ '^https?://' and char_length(source_url) <= 1000),
  add column source_summary text check (char_length(source_summary) <= 3000),
  add column ai_brief jsonb check (ai_brief is null or jsonb_typeof(ai_brief) = 'object'),
  add column suggested_tools text[] not null default '{}' check (cardinality(suggested_tools) <= 12 and public.short_texts(suggested_tools, 80)),
  add column production_notes jsonb not null default '{}'::jsonb check (jsonb_typeof(production_notes) = 'object'),
  add column ip_terms jsonb not null default '{}'::jsonb check (jsonb_typeof(ip_terms) = 'object'),
  add column guideline_id uuid references public.brand_guidelines(id) on delete set null,
  add column studio_step smallint not null default 1 check (studio_step between 1 and 4),
  add column is_sprint boolean not null default false,
  add column sprint_deadline timestamptz,
  add constraint campaigns_sprint_deadline_check check (not is_sprint or sprint_deadline is not null);
create index campaigns_sprint_idx on public.campaigns(sprint_deadline) where is_sprint;

-- Sprints are 48-hour micro-campaigns. End users can't stretch the window or move it after creation.
create or replace function public.tg_campaigns_sprint()
returns trigger language plpgsql as $$
begin
  if not public.is_end_user_session() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_sprint then
      new.sprint_deadline := coalesce(new.sprint_deadline, now() + interval '48 hours');
      if new.sprint_deadline <= now() + interval '1 hour' or new.sprint_deadline > now() + interval '72 hours' then
        raise exception 'A sprint deadline must be between 1 and 72 hours from now';
      end if;
      new.deadline := (new.sprint_deadline at time zone 'utc')::date;
    else
      new.sprint_deadline := null;
    end if;
  else
    if new.is_sprint is distinct from old.is_sprint or new.sprint_deadline is distinct from old.sprint_deadline then
      raise exception 'A campaign''s sprint window can''t be changed after it is created';
    end if;
  end if;
  return new;
end $$;
create trigger campaigns_sprint before insert or update on public.campaigns
  for each row execute function public.tg_campaigns_sprint();

-- A sprint is closed once its deadline passes (computed on read; enforced on every write below).
create or replace function public.sprint_closed(p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_sprint and sprint_deadline <= now() from public.campaigns where id = p_campaign), false);
$$;

-- ---------------------------------------------------------------------------
-- Projects: campaign_creators becomes the per-creator project with a validated state machine
-- applied → shortlisted → hired → in_progress → submitted → revision_requested → resubmitted → (submitted)
--   → approved → completed | rejected | cancelled
-- ---------------------------------------------------------------------------
alter table public.campaign_creators drop constraint campaign_creators_status_check;
alter table public.campaign_creators
  add column id uuid not null default gen_random_uuid(),
  add column hired_at timestamptz,
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add column status_changed_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();
alter table public.campaign_creators add constraint campaign_creators_id_key unique (id);

-- Existing selections were hires; keep their dates and amounts exactly as they are.
update public.campaign_creators
  set status = case when status = 'selected' then 'hired' else status end,
      hired_at = created_at,
      completed_at = case when status = 'completed' then coalesce(paid_at, created_at) end,
      status_changed_at = created_at
  where true;

alter table public.campaign_creators alter column status set default 'hired';
alter table public.campaign_creators add constraint campaign_creators_status_check check (status in (
  'applied', 'shortlisted', 'hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted',
  'approved', 'completed', 'rejected', 'cancelled'));
-- Work can only start, be approved or complete once the creator is actually hired.
alter table public.campaign_creators add constraint campaign_creators_hired_check
  check (status not in ('hired', 'in_progress', 'approved', 'completed') or hired_at is not null);
create index campaign_creators_status_idx on public.campaign_creators(campaign_id, status);

create or replace function public.project_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('applied', 'shortlisted'), ('applied', 'hired'), ('applied', 'submitted'), ('applied', 'rejected'), ('applied', 'cancelled'),
    ('shortlisted', 'applied'), ('shortlisted', 'hired'), ('shortlisted', 'submitted'), ('shortlisted', 'rejected'), ('shortlisted', 'cancelled'),
    ('hired', 'in_progress'), ('hired', 'submitted'), ('hired', 'cancelled'),
    ('in_progress', 'submitted'), ('in_progress', 'cancelled'),
    ('submitted', 'revision_requested'), ('submitted', 'approved'), ('submitted', 'rejected'), ('submitted', 'cancelled'),
    ('revision_requested', 'resubmitted'), ('revision_requested', 'rejected'), ('revision_requested', 'cancelled'),
    ('resubmitted', 'submitted'), ('resubmitted', 'revision_requested'), ('resubmitted', 'approved'),
    ('resubmitted', 'rejected'), ('resubmitted', 'cancelled'),
    ('approved', 'completed')
  );
$$;

-- Enforced for everyone, including the service role: no path can skip a step.
create or replace function public.tg_project_transition()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if not public.project_transition_allowed(old.status, new.status) then
      raise exception 'Invalid project transition: % → %', old.status, new.status using errcode = '23514';
    end if;
    -- Submitting without being hired is only possible in a sprint (spec work before hiring)
    if new.status = 'submitted' and old.status in ('applied', 'shortlisted')
       and not exists (select 1 from public.campaigns where id = new.campaign_id and is_sprint) then
      raise exception 'You need to be hired before submitting work' using errcode = '23514';
    end if;
    new.status_changed_at := now();
    if new.status = 'in_progress' then new.started_at := coalesce(new.started_at, now()); end if;
    if new.status = 'completed' then new.completed_at := now(); end if;
  end if;
  return new;
end $$;
create trigger campaign_creators_transition before update on public.campaign_creators
  for each row execute function public.tg_project_transition();

-- ---------------------------------------------------------------------------
-- Timeline (also the source of project notifications + system messages, see 0017)
-- ---------------------------------------------------------------------------
create table public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.campaign_creators(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('status', 'payment', 'certificate', 'comment')),
  event text not null check (char_length(event) between 2 and 40),
  from_status text,
  to_status text,
  note text check (char_length(note) <= 2000),
  data jsonb not null default '{}'::jsonb,
  notify boolean not null default true,
  created_at timestamptz not null default clock_timestamp()   -- keeps order within one transaction
);
create index project_events_project_idx on public.project_events(project_id, created_at);

-- ---------------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.campaign_creators(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  version int not null check (version between 1 and 50),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'revision_requested', 'approved', 'rejected')),
  notes text check (char_length(notes) <= 4000),
  tools_used text[] not null default '{}' check (cardinality(tools_used) <= 20 and public.short_texts(tools_used, 80)),
  workflow_notes text check (char_length(workflow_notes) <= 4000),
  ai_generated_declared boolean not null default false,
  commercial_terms_accepted boolean not null default false,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, creator_id, version),
  check (status = 'draft' or (submitted_at is not null and ai_generated_declared and commercial_terms_accepted))
);
create index submissions_project_idx on public.submissions(project_id, version desc);
create index submissions_campaign_idx on public.submissions(campaign_id, status, submitted_at desc);
create unique index submissions_one_draft_idx on public.submissions(project_id) where status = 'draft';

create trigger submissions_touch before update on public.submissions
  for each row execute function public.touch_updated_at();

-- Late submissions are rejected server-side for every path (RPC, direct SQL, service role).
create or replace function public.tg_submissions_guard()
returns trigger language plpgsql as $$
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status = 'draft') then
    if public.sprint_closed(new.campaign_id) then
      raise exception 'This sprint closed at its deadline — submissions are no longer accepted' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' and public.is_end_user_session() then
    if (new.notes, new.tools_used, new.workflow_notes, new.ai_generated_declared, new.commercial_terms_accepted, new.version)
       is distinct from
       (old.notes, old.tools_used, old.workflow_notes, old.ai_generated_declared, old.commercial_terms_accepted, old.version) then
      raise exception 'A submitted version can''t be edited — submit a new version instead' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger submissions_guard before insert or update on public.submissions
  for each row execute function public.tg_submissions_guard();

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  position smallint not null default 0 check (position between 0 and 50),
  kind text not null check (kind in ('upload', 'link')),
  media_type text not null check (media_type in ('image', 'video', 'link')),
  file_name text check (char_length(file_name) <= 200),
  mime_type text check (char_length(mime_type) <= 100),
  size_bytes bigint check (size_bytes >= 0),
  storage_path text check (char_length(storage_path) <= 500),       -- original, private bucket "submissions"
  preview_path text check (char_length(preview_path) <= 500),       -- watermarked, private bucket "submission-previews"
  thumbnail_path text check (char_length(thumbnail_path) <= 500),   -- watermarked poster
  frame_paths text[] not null default '{}' check (cardinality(frame_paths) <= 12),  -- watermarked sampled frames
  preview_kind text check (preview_kind in ('image_watermark', 'video_ffmpeg', 'video_frames', 'external_link')),
  width int check (width between 1 and 20000),
  height int check (height between 1 and 20000),
  duration_ms int check (duration_ms between 0 and 36000000),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  link_url text check (link_url ~ '^https?://' and char_length(link_url) <= 1000),
  palette text[] not null default '{}' check (cardinality(palette) <= 12 and public.is_hex_colors(palette)),
  created_at timestamptz not null default now(),
  check ((kind = 'upload' and storage_path is not null and media_type in ('image', 'video'))
      or (kind = 'link' and link_url is not null and media_type = 'link'))
);
create index submission_files_submission_idx on public.submission_files(submission_id, position);

create table public.submission_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  decision text not null check (decision in ('approved', 'revision_requested', 'rejected')),
  feedback text check (char_length(feedback) <= 4000),
  created_at timestamptz not null default now(),
  check (decision = 'approved' or char_length(trim(coalesce(feedback, ''))) >= 5)
);
create index submission_reviews_submission_idx on public.submission_reviews(submission_id, created_at);

create table public.submission_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  file_id uuid references public.submission_files(id) on delete cascade,
  timestamp_ms int check (timestamp_ms between 0 and 36000000),   -- optional position in a video
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index submission_comments_submission_idx on public.submission_comments(submission_id, created_at);

-- ---------------------------------------------------------------------------
-- AI review (background job results + job log)
-- ---------------------------------------------------------------------------
create table public.ai_review_results (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  brand_match_score int check (brand_match_score between 0 and 100),
  checks jsonb not null default '{}'::jsonb check (jsonb_typeof(checks) = 'object'),
  insights jsonb not null default '{}'::jsonb check (jsonb_typeof(insights) = 'object'),
  model_name text,
  error text check (char_length(error) <= 1000),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ai_review_results_touch before update on public.ai_review_results
  for each row execute function public.touch_updated_at();

create table public.ai_job_logs (
  id bigint generated always as identity primary key,
  submission_id uuid references public.submissions(id) on delete cascade,
  job text not null check (job in ('submission_review', 'watermark', 'certificate')),
  status text not null check (status in ('started', 'done', 'failed')),
  message text check (char_length(message) <= 2000),
  duration_ms int,
  created_at timestamptz not null default now()
);
create index ai_job_logs_submission_idx on public.ai_job_logs(submission_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Escrow ledger — INTERNAL TEST MODE: no real money moves.
-- ---------------------------------------------------------------------------
create table public.escrow_payments (
  id uuid primary key default gen_random_uuid(),
  campaign_creator_id uuid not null unique references public.campaign_creators(id) on delete cascade,
  amount int not null check (amount > 0),
  currency text not null check (char_length(currency) = 3),
  platform_fee int not null default 0 check (platform_fee >= 0),   -- charged to the brand on top of the amount
  status text not null default 'unfunded' check (status in ('unfunded', 'funded', 'released', 'refunded', 'disputed')),
  provider text not null default 'internal' check (provider in ('internal', 'stripe_test')),
  provider_ref text check (char_length(provider_ref) <= 200),
  funded_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  disputed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger escrow_payments_touch before update on public.escrow_payments
  for each row execute function public.touch_updated_at();

create or replace function public.escrow_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('unfunded', 'funded'), ('funded', 'released'), ('funded', 'refunded'), ('funded', 'disputed'),
    ('disputed', 'released'), ('disputed', 'refunded'));
$$;

create or replace function public.tg_escrow_guard()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and not public.escrow_transition_allowed(old.status, new.status) then
    raise exception 'Invalid escrow transition: % → %', old.status, new.status using errcode = '23514';
  end if;
  if old.status <> 'unfunded' and (new.amount, new.currency, new.platform_fee) is distinct from (old.amount, old.currency, old.platform_fee) then
    raise exception 'The amount is locked once escrow is funded' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger escrow_payments_guard before update on public.escrow_payments
  for each row execute function public.tg_escrow_guard();

-- Immutable ledger: one row per status change. No updates or deletes, for anyone.
create table public.payment_events (
  id bigint generated always as identity primary key,
  escrow_id uuid not null references public.escrow_payments(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event text not null check (event in ('created', 'amount_set', 'funded', 'released', 'refunded', 'disputed')),
  from_status text,
  to_status text not null,
  amount int not null,
  currency text not null,
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default clock_timestamp()
);
create index payment_events_escrow_idx on public.payment_events(escrow_id, created_at);

create or replace function public.tg_ledger_immutable()
returns trigger language plpgsql as $$
begin
  -- Cascading deletes from a removed project are allowed; direct edits are not.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'The payment ledger is append-only' using errcode = '42501';
end $$;
create trigger payment_events_immutable before update or delete on public.payment_events
  for each row execute function public.tg_ledger_immutable();

-- ---------------------------------------------------------------------------
-- Commercial IP certificates (platform-generated licence records, not legal advice)
-- ---------------------------------------------------------------------------
create table public.ip_certificates (
  id uuid primary key default gen_random_uuid(),
  certificate_id text not null unique check (certificate_id ~ '^CRT-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$'),
  campaign_creator_id uuid not null unique references public.campaign_creators(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  brand_id uuid not null references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete set null,
  terms jsonb not null check (jsonb_typeof(terms) = 'object'),
  tools_declared text[] not null default '{}',
  asset_hashes jsonb not null default '[]'::jsonb check (jsonb_typeof(asset_hashes) = 'array'),
  generated_at timestamptz not null default now(),
  pdf_path text check (char_length(pdf_path) <= 300)
);

-- ---------------------------------------------------------------------------
-- Two-way reviews after completion
-- ---------------------------------------------------------------------------
create table public.project_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.campaign_creators(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text check (char_length(body) <= 1500),
  created_at timestamptz not null default now(),
  unique (project_id, author_id),
  check (author_id <> subject_id)
);
create index project_reviews_subject_idx on public.project_reviews(subject_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Messages: system messages for project updates; clients can only write plain user messages
-- ---------------------------------------------------------------------------
alter table public.messages add column kind text not null default 'user' check (kind in ('user', 'system'));
revoke insert on public.messages from anon, authenticated;
grant insert (conversation_id, sender_id, body) on public.messages to authenticated;

-- Notifications for project and payment updates
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in
  ('follow', 'like', 'comment', 'application', 'shortlisted', 'selected', 'message', 'verification', 'project', 'payment'));
alter table public.notifications drop constraint notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check check (entity_type in
  ('profile', 'post', 'campaign', 'conversation', 'verification', 'project'));

-- ---------------------------------------------------------------------------
-- Access helpers (security definer: safe to use inside RLS policies)
-- ---------------------------------------------------------------------------
-- 'creator' | 'brand' | 'admin' | null for the caller on a project
create or replace function public.project_role(p_project uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when x.creator_id = auth.uid() then 'creator'
    when c.brand_id = auth.uid() then 'brand'
    when public.is_admin() then 'admin'
  end
  from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
  where x.id = p_project;
$$;

create or replace function public.can_view_submission(p_submission uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.submissions s join public.campaigns c on c.id = s.campaign_id
    where s.id = p_submission
      and (s.creator_id = auth.uid()
           or (c.brand_id = auth.uid() and s.status <> 'draft')
           or public.is_admin()));
$$;

-- Clean originals: the creator always; the brand only once the submission is approved AND escrow is funded/released.
create or replace function public.can_access_originals(p_submission uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.submissions s
    join public.campaigns c on c.id = s.campaign_id
    left join public.escrow_payments e on e.campaign_creator_id = s.project_id
    where s.id = p_submission
      and (s.creator_id = auth.uid()
           or public.is_admin()
           or (c.brand_id = auth.uid() and s.status = 'approved' and e.status in ('funded', 'released'))));
$$;

create or replace function public.uuid_or_null(p text)
returns uuid language sql immutable as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;

-- Storage object paths: "<creator uid>/<submission id>/<file>"
create or replace function public.can_read_submission_object(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_bucket
    when 'submissions' then public.can_access_originals(public.uuid_or_null(split_part(p_name, '/', 2)))
    when 'submission-previews' then public.can_view_submission(public.uuid_or_null(split_part(p_name, '/', 2)))
    else false
  end;
$$;

create or replace function public.is_own_draft_path(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.submissions s
    where s.id = public.uuid_or_null(split_part(p_name, '/', 2))
      and s.creator_id = auth.uid()
      and split_part(p_name, '/', 1) = auth.uid()::text
      and s.status = 'draft');
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.brand_guidelines enable row level security;
alter table public.project_events enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_files enable row level security;
alter table public.submission_reviews enable row level security;
alter table public.submission_comments enable row level security;
alter table public.ai_review_results enable row level security;
alter table public.ai_job_logs enable row level security;
alter table public.escrow_payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.ip_certificates enable row level security;
alter table public.project_reviews enable row level security;

-- Guidelines: the brand; creators working on a campaign that uses them; admins
create policy "guidelines visible to brand, its project creators, admins" on public.brand_guidelines for select to authenticated
  using (brand_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.campaigns c join public.campaign_creators x on x.campaign_id = c.id
                    where c.guideline_id = brand_guidelines.id and x.creator_id = auth.uid()));
create policy "guidelines brand insert" on public.brand_guidelines for insert to authenticated
  with check (brand_id = auth.uid() and public.current_app_role() = 'brand');
create policy "guidelines brand update" on public.brand_guidelines for update to authenticated
  using (brand_id = auth.uid()) with check (brand_id = auth.uid());
create policy "guidelines brand delete" on public.brand_guidelines for delete to authenticated
  using (brand_id = auth.uid());

-- A campaign can only reference its own brand's guidelines
create or replace function public.tg_campaigns_guideline()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.guideline_id is not null and not exists (
       select 1 from public.brand_guidelines where id = new.guideline_id and brand_id = new.brand_id) then
    raise exception 'Those brand guidelines belong to another brand' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger campaigns_guideline before insert or update of guideline_id on public.campaigns
  for each row execute function public.tg_campaigns_guideline();

create policy "project events visible to parties" on public.project_events for select to authenticated
  using (public.project_role(project_id) is not null);

create policy "submissions visible to creator, brand (once submitted), admins" on public.submissions for select to authenticated
  using (public.can_view_submission(id));
create policy "creator edits own draft" on public.submissions for update to authenticated
  using (creator_id = auth.uid() and status = 'draft') with check (creator_id = auth.uid() and status = 'draft');

create policy "files visible with their submission" on public.submission_files for select to authenticated
  using (public.can_view_submission(submission_id));
create policy "creator removes files from own draft" on public.submission_files for delete to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id and s.creator_id = auth.uid() and s.status = 'draft'));

create policy "reviews visible with their submission" on public.submission_reviews for select to authenticated
  using (public.can_view_submission(submission_id));

create policy "comments visible with their submission" on public.submission_comments for select to authenticated
  using (public.can_view_submission(submission_id));
create policy "parties comment on submitted work" on public.submission_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_active_user()
              and exists (select 1 from public.submissions s where s.id = submission_id and s.status <> 'draft')
              and public.can_view_submission(submission_id));

-- AI review results are a brand-side review aid
create policy "ai results visible to the campaign brand and admins" on public.ai_review_results for select to authenticated
  using (exists (select 1 from public.submissions s join public.campaigns c on c.id = s.campaign_id
                 where s.id = submission_id and (c.brand_id = auth.uid() or public.is_admin())));
create policy "ai job logs visible to the campaign brand and admins" on public.ai_job_logs for select to authenticated
  using (exists (select 1 from public.submissions s join public.campaigns c on c.id = s.campaign_id
                 where s.id = submission_id and (c.brand_id = auth.uid() or public.is_admin())));

create policy "escrow visible to parties" on public.escrow_payments for select to authenticated
  using (public.project_role(campaign_creator_id) is not null);
create policy "ledger visible to parties" on public.payment_events for select to authenticated
  using (exists (select 1 from public.escrow_payments e where e.id = escrow_id and public.project_role(e.campaign_creator_id) is not null));

create policy "certificates visible to parties" on public.ip_certificates for select to authenticated
  using (brand_id = auth.uid() or creator_id = auth.uid() or public.is_admin());

create policy "project reviews are public" on public.project_reviews for select using (true);
create policy "parties review each other after completion" on public.project_reviews for insert to authenticated
  with check (author_id = auth.uid() and public.is_active_user()
              and public.project_role(project_id) in ('creator', 'brand')
              and exists (select 1 from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
                          where x.id = project_id and x.status = 'completed'
                            and subject_id = case when x.creator_id = auth.uid() then c.brand_id else x.creator_id end));

-- Projects: all writes go through the workflow RPCs (0017)
drop policy if exists "selections brand insert" on public.campaign_creators;
drop policy if exists "selections brand update" on public.campaign_creators;
drop policy if exists "selections brand delete" on public.campaign_creators;
revoke insert, update, delete on public.campaign_creators from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Data API privileges (0011 conventions: explicit, minimal)
-- ---------------------------------------------------------------------------
revoke all on public.brand_guidelines, public.project_events, public.submissions, public.submission_files,
  public.submission_reviews, public.submission_comments, public.ai_review_results, public.ai_job_logs,
  public.escrow_payments, public.payment_events, public.ip_certificates, public.project_reviews
  from anon, authenticated;
grant select on public.brand_guidelines, public.project_events, public.submissions, public.submission_files,
  public.submission_reviews, public.submission_comments, public.ai_review_results, public.ai_job_logs,
  public.escrow_payments, public.payment_events, public.ip_certificates, public.project_reviews
  to authenticated;
grant select on public.project_reviews to anon;
grant all on public.brand_guidelines, public.project_events, public.submissions, public.submission_files,
  public.submission_reviews, public.submission_comments, public.ai_review_results, public.ai_job_logs,
  public.escrow_payments, public.payment_events, public.ip_certificates, public.project_reviews
  to service_role;

grant insert, delete on public.brand_guidelines to authenticated;
grant update (name, logo_url, primary_colors, secondary_colors, fonts, tone_of_voice, visual_style, dos, donts, restricted_content)
  on public.brand_guidelines to authenticated;
grant update (notes, tools_used, workflow_notes, ai_generated_declared, commercial_terms_accepted)
  on public.submissions to authenticated;
grant delete on public.submission_files to authenticated;
grant insert (submission_id, author_id, file_id, timestamp_ms, body) on public.submission_comments to authenticated;
grant insert (project_id, author_id, subject_id, rating, body) on public.project_reviews to authenticated;

revoke execute on function public.project_role(uuid), public.can_view_submission(uuid), public.can_access_originals(uuid),
  public.can_read_submission_object(text, text), public.is_own_draft_path(text), public.sprint_closed(uuid)
  from public, anon;
grant execute on function public.project_role(uuid), public.can_view_submission(uuid), public.can_access_originals(uuid),
  public.can_read_submission_object(text, text), public.is_own_draft_path(text), public.sprint_closed(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private storage: originals (creator uploads) and watermarked previews / certificates (server only)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('submissions', 'submissions', false, 52428800,
     array['image/png','image/jpeg','image/webp','video/mp4','video/webm','video/quicktime']),
  ('submission-previews', 'submission-previews', false, 52428800,
     array['image/jpeg','image/webp','video/mp4']),
  ('certificates', 'certificates', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "submission objects read" on storage.objects;
drop policy if exists "submission originals own draft insert" on storage.objects;
drop policy if exists "submission originals own draft delete" on storage.objects;

create policy "submission objects read" on storage.objects for select to authenticated
  using (bucket_id in ('submissions', 'submission-previews') and public.can_read_submission_object(bucket_id, name));
create policy "submission originals own draft insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and public.is_own_draft_path(name));
create policy "submission originals own draft delete" on storage.objects for delete to authenticated
  using (bucket_id = 'submissions' and public.is_own_draft_path(name));
