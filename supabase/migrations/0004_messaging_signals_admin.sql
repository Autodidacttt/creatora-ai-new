-- 0004: messaging, interaction signals, notifications, verification, moderation

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  dm_key text unique,                 -- "<smaller uuid>:<larger uuid>" for 1:1 threads
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index conversations_last_idx on public.conversations(last_message_at desc nulls last);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default to_timestamp(0),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_participants_user_idx on public.conversation_participants(user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages(conversation_id, created_at desc);

-- Behavioural signals for swipe decks and recommendations
create table public.interactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('profile','post','campaign')),
  target_id uuid not null,
  action text not null check (action in
    ('view','like','save','follow','swipe_left','swipe_right','contact','ignore','apply','shortlist')),
  weight real not null default 1,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index interactions_user_idx on public.interactions(user_id, target_type, action);
create index interactions_target_idx on public.interactions(target_type, target_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  type text not null check (type in
    ('follow','like','comment','application','shortlisted','selected','message','verification')),
  entity_type text check (entity_type in ('profile','post','campaign','conversation','verification')),
  entity_id uuid,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id) where read_at is null;

create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('tool','workflow','past_work','identity')),
  tool_id int references public.ai_tools(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  experience_id uuid references public.creator_experiences(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 160),
  evidence_url text check (char_length(evidence_url) <= 1000),
  evidence_notes text check (char_length(evidence_notes) <= 2000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text check (char_length(review_notes) <= 1000),
  created_at timestamptz not null default now(),
  check (type <> 'tool' or tool_id is not null),
  check (type <> 'workflow' or post_id is not null),
  check (type <> 'past_work' or experience_id is not null)
);
create index verifications_creator_idx on public.verifications(creator_id, status);
create index verifications_status_idx on public.verifications(status, created_at);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('profile','post','comment','campaign','message')),
  target_id uuid not null,
  reason text not null check (reason in ('spam','harassment','ip_infringement','misleading','inappropriate','other')),
  details text check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_status_idx on public.reports(status, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);
