-- 0014: Creator Dashboard — tracking tables, recording RPCs, aggregation RPCs, AI-insight cache,
-- and a service-role-only generator for demo history.
-- Raw tracking rows are never readable by clients; dashboards read only aggregates via RPCs that
-- verify the caller is the creator (or an admin).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.post_views (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,   -- denormalised for fast aggregation
  viewer_id uuid references public.profiles(id) on delete set null,          -- null = not signed in / unknown
  watch_duration int check (watch_duration between 0 and 3600000),            -- milliseconds
  source text not null default 'app' check (source in ('app', 'seed')),       -- 'seed' = generated demo history
  created_at timestamptz not null default now()
);
create index post_views_creator_idx on public.post_views(creator_id, created_at);
create index post_views_post_idx on public.post_views(post_id, created_at);
create index post_views_dedupe_idx on public.post_views(viewer_id, post_id, created_at desc) where viewer_id is not null;

create table public.profile_visits (
  id bigint generated always as identity primary key,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  visitor_id uuid references public.profiles(id) on delete set null,
  source text not null default 'app' check (source in ('app', 'seed')),
  created_at timestamptz not null default now()
);
create index profile_visits_creator_idx on public.profile_visits(creator_id, created_at);
create index profile_visits_dedupe_idx on public.profile_visits(visitor_id, creator_id, created_at desc) where visitor_id is not null;

alter table public.campaign_creators
  add column agreed_amount int check (agreed_amount >= 0),
  add column currency text not null default 'USD' check (char_length(currency) = 3),
  add column payment_status text not null default 'pending' check (payment_status in ('pending', 'paid')),
  add column paid_at timestamptz;

create table public.creator_ai_insights (
  creator_id uuid primary key references public.profiles(id) on delete cascade,
  evidence jsonb not null,
  insights jsonb not null,
  model text,
  generated_at timestamptz not null default now()
);

alter table public.post_views enable row level security;
alter table public.profile_visits enable row level security;
alter table public.creator_ai_insights enable row level security;

-- No client policies on raw tracking rows: they are written by record_* RPCs and read only as aggregates.
revoke all on public.post_views, public.profile_visits from anon, authenticated;
grant all on public.post_views, public.profile_visits to service_role;

create policy "own ai insights" on public.creator_ai_insights for select to authenticated using (creator_id = auth.uid());
revoke all on public.creator_ai_insights from anon, authenticated;
grant select on public.creator_ai_insights to authenticated;
grant all on public.creator_ai_insights to service_role;

-- ---------------------------------------------------------------------------
-- Recording (from the real UI). De-duplicated per viewer within 30 minutes.
-- ---------------------------------------------------------------------------
create or replace function public.record_post_view(p_post uuid, p_watch_ms int default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_recent bigint;
  v_ms int := case when p_watch_ms is null then null else least(greatest(p_watch_ms, 0), 3600000) end;
begin
  if v_uid is null or not public.is_active_user() then return; end if;
  select creator_id into v_creator from public.posts where id = p_post and not is_removed;
  if v_creator is null or v_creator = v_uid then return; end if;   -- own views don't count

  select id into v_recent from public.post_views
  where viewer_id = v_uid and post_id = p_post and created_at > now() - interval '30 minutes'
  order by created_at desc limit 1;

  if v_recent is not null then
    if v_ms is not null then
      update public.post_views set watch_duration = least(coalesce(watch_duration, 0) + v_ms, 3600000) where id = v_recent;
    end if;
    return;
  end if;
  insert into public.post_views (post_id, creator_id, viewer_id, watch_duration) values (p_post, v_creator, v_uid, v_ms);
end $$;

create or replace function public.record_profile_visit(p_creator uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or v_uid = p_creator or not public.is_active_user() then return; end if;
  if not exists (select 1 from public.profiles where id = p_creator and role = 'creator') then return; end if;
  if exists (select 1 from public.profile_visits where visitor_id = v_uid and creator_id = p_creator
             and created_at > now() - interval '30 minutes') then return; end if;
  insert into public.profile_visits (creator_id, visitor_id) values (p_creator, v_uid);
end $$;

-- ---------------------------------------------------------------------------
-- Access check shared by every dashboard RPC
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_assert(p_creator uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_creator is distinct from auth.uid() and not public.is_admin() then
    raise exception 'You can only view your own dashboard' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_creator and role = 'creator') then
    raise exception 'Dashboards are available to creators only' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Daily time series for a date range (UTC days, inclusive)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_series(p_creator uuid, p_from date, p_to date)
returns table (day date, views int, watch_ms bigint, likes int, comments int, saves int,
               new_followers int, followers int, visits int, inquiries int, earnings bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.dashboard_assert(p_creator);
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Invalid date range'; end if;
  return query
  with days as (select d::date as day from generate_series(p_from, p_to, interval '1 day') d),
  v as (select (created_at at time zone 'utc')::date d, count(*) n, coalesce(sum(watch_duration), 0) ms
        from public.post_views where creator_id = p_creator
          and created_at >= p_from::timestamptz and created_at < (p_to + 1)::timestamptz group by 1),
  l as (select (l.created_at at time zone 'utc')::date d, count(*) n from public.likes l join public.posts p on p.id = l.post_id
        where p.creator_id = p_creator and l.user_id <> p_creator
          and l.created_at >= p_from::timestamptz and l.created_at < (p_to + 1)::timestamptz group by 1),
  c as (select (c.created_at at time zone 'utc')::date d, count(*) n from public.comments c join public.posts p on p.id = c.post_id
        where p.creator_id = p_creator and c.user_id <> p_creator
          and c.created_at >= p_from::timestamptz and c.created_at < (p_to + 1)::timestamptz group by 1),
  s as (select (s.created_at at time zone 'utc')::date d, count(*) n from public.saves s join public.posts p on p.id = s.post_id
        where p.creator_id = p_creator and s.user_id <> p_creator
          and s.created_at >= p_from::timestamptz and s.created_at < (p_to + 1)::timestamptz group by 1),
  f as (select (created_at at time zone 'utc')::date d, count(*) n from public.follows
        where following_id = p_creator and created_at >= p_from::timestamptz and created_at < (p_to + 1)::timestamptz group by 1),
  fbase as (select count(*) n from public.follows where following_id = p_creator and created_at < p_from::timestamptz),
  pv as (select (created_at at time zone 'utc')::date d, count(*) n from public.profile_visits
         where creator_id = p_creator and created_at >= p_from::timestamptz and created_at < (p_to + 1)::timestamptz group by 1),
  -- brand inquiry = a conversation with a brand whose first message came from the brand
  firsts as (
    select distinct on (m.conversation_id) m.conversation_id, m.sender_id, m.created_at
    from public.messages m
    join public.conversation_participants me on me.conversation_id = m.conversation_id and me.user_id = p_creator
    order by m.conversation_id, m.created_at),
  inq as (select (fm.created_at at time zone 'utc')::date d, count(*) n from firsts fm
          join public.profiles b on b.id = fm.sender_id and b.role = 'brand'
          where fm.created_at >= p_from::timestamptz and fm.created_at < (p_to + 1)::timestamptz group by 1),
  e as (select (paid_at at time zone 'utc')::date d, sum(agreed_amount) n from public.campaign_creators
        where creator_id = p_creator and payment_status = 'paid'
          and paid_at >= p_from::timestamptz and paid_at < (p_to + 1)::timestamptz group by 1)
  select days.day,
    coalesce(v.n, 0)::int, coalesce(v.ms, 0)::bigint, coalesce(l.n, 0)::int, coalesce(c.n, 0)::int, coalesce(s.n, 0)::int,
    coalesce(f.n, 0)::int,
    ((select n from fbase) + sum(coalesce(f.n, 0)) over (order by days.day))::int,
    coalesce(pv.n, 0)::int, coalesce(inq.n, 0)::int, coalesce(e.n, 0)::bigint
  from days
  left join v on v.d = days.day left join l on l.d = days.day left join c on c.d = days.day
  left join s on s.d = days.day left join f on f.d = days.day left join pv on pv.d = days.day
  left join inq on inq.d = days.day left join e on e.d = days.day
  order by days.day;
end $$;

-- ---------------------------------------------------------------------------
-- Totals for the range and the equally long previous period (engagement rate computed here)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_summary(p_creator uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_len int := p_to - p_from + 1;
  cur jsonb; prev jsonb;
  v_currency text;
begin
  perform public.dashboard_assert(p_creator);
  select coalesce((select currency from public.campaign_creators where creator_id = p_creator and agreed_amount is not null
                   group by currency order by sum(agreed_amount) desc limit 1),
                  (select currency from public.creator_details where profile_id = p_creator), 'USD') into v_currency;

  select jsonb_build_object(
      'views', sum(views), 'watch_ms', sum(watch_ms), 'likes', sum(likes), 'comments', sum(comments), 'saves', sum(saves),
      'engagements', sum(likes + comments + saves),
      'engagement_rate', case when sum(views) > 0 then round(100.0 * sum(likes + comments + saves) / sum(views), 2) end,
      'new_followers', sum(new_followers), 'followers', max(followers) filter (where day = p_to),
      'visits', sum(visits), 'inquiries', sum(inquiries), 'earnings', sum(earnings))
    into cur from public.dashboard_series(p_creator, p_from, p_to);
  select jsonb_build_object(
      'views', sum(views), 'watch_ms', sum(watch_ms), 'likes', sum(likes), 'comments', sum(comments), 'saves', sum(saves),
      'engagements', sum(likes + comments + saves),
      'engagement_rate', case when sum(views) > 0 then round(100.0 * sum(likes + comments + saves) / sum(views), 2) end,
      'new_followers', sum(new_followers), 'followers', max(followers) filter (where day = p_from - 1),
      'visits', sum(visits), 'inquiries', sum(inquiries), 'earnings', sum(earnings))
    into prev from public.dashboard_series(p_creator, p_from - v_len, p_from - 1);

  return jsonb_build_object(
    'current', cur, 'previous', prev, 'currency', v_currency,
    'pending_payments', (select coalesce(sum(agreed_amount), 0) from public.campaign_creators
                         where creator_id = p_creator and payment_status = 'pending' and agreed_amount is not null),
    'posts', (select count(*) from public.posts where creator_id = p_creator and not is_removed),
    'has_activity', exists (select 1 from public.post_views where creator_id = p_creator)
                    or exists (select 1 from public.follows where following_id = p_creator)
                    or exists (select 1 from public.profile_visits where creator_id = p_creator));
end $$;

-- ---------------------------------------------------------------------------
-- Per-post performance in range
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_posts(p_creator uuid, p_from date, p_to date, p_limit int default 30)
returns table (post_id uuid, title text, thumbnail text, media_type text, aspect_ratio text, created_at timestamptz,
               views int, avg_watch_ms int, likes int, comments int, saves int, engagement_rate numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.dashboard_assert(p_creator);
  return query
  select p.id, p.title, coalesce(p.thumbnail_url, case when p.media_type = 'image' then p.media_url end), p.media_type, p.aspect_ratio, p.created_at,
    vv.n::int, vv.avg_ms::int, ll.n::int, cc.n::int, ss.n::int,
    case when vv.n > 0 then round(100.0 * (ll.n + cc.n + ss.n) / vv.n, 2) end
  from public.posts p
  cross join lateral (select count(*) n, avg(watch_duration) avg_ms from public.post_views x
                      where x.post_id = p.id and x.created_at >= p_from::timestamptz and x.created_at < (p_to + 1)::timestamptz) vv
  cross join lateral (select count(*) n from public.likes x where x.post_id = p.id and x.user_id <> p_creator
                      and x.created_at >= p_from::timestamptz and x.created_at < (p_to + 1)::timestamptz) ll
  cross join lateral (select count(*) n from public.comments x where x.post_id = p.id and x.user_id <> p_creator
                      and x.created_at >= p_from::timestamptz and x.created_at < (p_to + 1)::timestamptz) cc
  cross join lateral (select count(*) n from public.saves x where x.post_id = p.id and x.user_id <> p_creator
                      and x.created_at >= p_from::timestamptz and x.created_at < (p_to + 1)::timestamptz) ss
  where p.creator_id = p_creator and not p.is_removed
  order by vv.n desc, (ll.n + cc.n + ss.n) desc, p.created_at desc
  limit greatest(least(p_limit, 60), 1);
end $$;

-- ---------------------------------------------------------------------------
-- Audience: registered people who follow / viewed / visited / engaged. Groups < 5 people are withheld.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_audience(p_creator uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_min int := 5; v_result jsonb;
begin
  perform public.dashboard_assert(p_creator);
  with people as (
    select follower_id uid from public.follows where following_id = p_creator
    union select viewer_id from public.post_views where creator_id = p_creator and viewer_id is not null
          and created_at >= p_from::timestamptz and created_at < (p_to + 1)::timestamptz
    union select visitor_id from public.profile_visits where creator_id = p_creator and visitor_id is not null
          and created_at >= p_from::timestamptz and created_at < (p_to + 1)::timestamptz
    union select l.user_id from public.likes l join public.posts p on p.id = l.post_id where p.creator_id = p_creator
          and l.created_at >= p_from::timestamptz and l.created_at < (p_to + 1)::timestamptz
    union select c.user_id from public.comments c join public.posts p on p.id = c.post_id where p.creator_id = p_creator
          and c.created_at >= p_from::timestamptz and c.created_at < (p_to + 1)::timestamptz
  ),
  aud as (select pr.* from people join public.profiles pr on pr.id = people.uid where pr.id <> p_creator),
  loc as (select nullif(trim(split_part(location, ',', -1)), '') label, count(*) n from aud where location is not null group by 1),
  lang as (select lg.name label, count(distinct a.id) n from aud a join public.creator_languages cl on cl.creator_id = a.id
           join public.languages lg on lg.id = cl.language_id group by 1),
  intr as (select label, count(distinct uid) n from (
             select a.id uid, cat.name label from aud a join public.creator_categories cc on cc.creator_id = a.id join public.categories cat on cat.id = cc.category_id
             union all
             select a.id, bd.industry from aud a join public.brand_details bd on bd.profile_id = a.id where bd.industry is not null) x group by 1),
  roles as (select initcap(role) label, count(*) n from aud group by 1),
  grp as (
    select 'locations' k, jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc) filter (where n >= v_min and label is not null) g,
           coalesce(sum(n) filter (where n < v_min or label is null), 0) hidden from loc
    union all select 'languages', jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc) filter (where n >= v_min), coalesce(sum(n) filter (where n < v_min), 0) from lang
    union all select 'interests', jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc) filter (where n >= v_min), coalesce(sum(n) filter (where n < v_min), 0) from intr
    union all select 'roles', jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc) filter (where n >= v_min), coalesce(sum(n) filter (where n < v_min), 0) from roles
  )
  select jsonb_build_object(
    'min_group', v_min,
    'audience_size', (select count(*) from aud),
    'followers', (select count(*) from public.follows where following_id = p_creator),
    'anonymous_views', (select count(*) from public.post_views where creator_id = p_creator and viewer_id is null
                        and created_at >= p_from::timestamptz and created_at < (p_to + 1)::timestamptz),
    'groups', coalesce((select jsonb_object_agg(k, coalesce(g, '[]'::jsonb)) from grp), '{}'::jsonb),
    'hidden', coalesce((select jsonb_object_agg(k, hidden) from grp), '{}'::jsonb))
  into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Content insights: performance grouped by post metadata
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_content(p_creator uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.dashboard_assert(p_creator);
  with perf as (
    select p.id, p.content_type_id, p.category_id, p.style_id, p.media_type, p.embed_provider,
      (select count(*) from public.post_views x where x.post_id = p.id and x.created_at >= p_from::timestamptz and x.created_at < (p_to + 1)::timestamptz) views,
      (select count(*) from public.likes x where x.post_id = p.id and x.user_id <> p_creator and x.created_at >= p_from::timestamptz and x.created_at < (p_to + 1)::timestamptz)
      + (select count(*) from public.comments x where x.post_id = p.id and x.user_id <> p_creator and x.created_at >= p_from::timestamptz and x.created_at < (p_to + 1)::timestamptz)
      + (select count(*) from public.saves x where x.post_id = p.id and x.user_id <> p_creator and x.created_at >= p_from::timestamptz and x.created_at < (p_to + 1)::timestamptz) eng
    from public.posts p where p.creator_id = p_creator and not p.is_removed
  ),
  dims as (
    select 'content_type' dim, ct.name label, perf.* from perf join public.content_types ct on ct.id = perf.content_type_id
    union all select 'category', c.name, perf.* from perf join public.categories c on c.id = perf.category_id
    union all select 'style', s.name, perf.* from perf join public.styles s on s.id = perf.style_id
    union all select 'tool', t.name, perf.* from perf join public.post_tools pt on pt.post_id = perf.id join public.ai_tools t on t.id = pt.tool_id
    union all select 'platform', case when perf.media_type = 'embed' then initcap(coalesce(perf.embed_provider, 'link'))
                                      else 'Native ' || perf.media_type end, perf.* from perf
  ),
  agg as (
    select dim, label, count(distinct id) posts, sum(views) views, sum(eng) engagements,
      case when sum(views) > 0 then round(100.0 * sum(eng) / sum(views), 2) end engagement_rate
    from dims group by dim, label
  )
  select coalesce(jsonb_object_agg(dim, items), '{}'::jsonb) into v from (
    select dim, jsonb_agg(jsonb_build_object('label', label, 'posts', posts, 'views', views, 'engagements', engagements,
                                             'engagement_rate', engagement_rate) order by views desc, posts desc) items
    from agg group by dim) x;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Career / marketplace funnel
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_career(p_creator uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.dashboard_assert(p_creator);
  with apps as (select * from public.campaign_applications where creator_id = p_creator and status <> 'withdrawn'
                and created_at >= p_from::timestamptz and created_at < (p_to + 1)::timestamptz),
  sl as (select * from public.campaign_shortlists where creator_id = p_creator
         and created_at >= p_from::timestamptz and created_at < (p_to + 1)::timestamptz),
  hired as (select * from public.campaign_creators where creator_id = p_creator
            and created_at >= p_from::timestamptz and created_at < (p_to + 1)::timestamptz),
  pipeline as (
    select c.id campaign_id, c.title, c.status campaign_status, b.display_name brand,
      a.status app_status, a.created_at applied_at,
      s.created_at shortlisted_at, x.created_at hired_at, x.status hire_status,
      x.agreed_amount, coalesce(x.currency, c.currency) currency, x.payment_status, x.paid_at,
      greatest(a.created_at, s.created_at, x.created_at) last_activity
    from public.campaigns c
    join public.profiles b on b.id = c.brand_id
    left join public.campaign_applications a on a.campaign_id = c.id and a.creator_id = p_creator and a.status <> 'withdrawn'
    left join public.campaign_shortlists s on s.campaign_id = c.id and s.creator_id = p_creator
    left join public.campaign_creators x on x.campaign_id = c.id and x.creator_id = p_creator
    where a.id is not null or s.campaign_id is not null or x.campaign_id is not null
  )
  select jsonb_build_object(
    'applications', (select count(*) from apps),
    'pending', (select count(*) from apps where status = 'pending'),
    'declined', (select count(*) from apps where status = 'rejected'),
    'shortlisted', (select count(*) from sl),
    'hired', (select count(*) from hired),
    'hired_from_applications', (select count(*) from hired h where exists (select 1 from apps a where a.campaign_id = h.campaign_id)),
    'active', (select count(*) from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
               where x.creator_id = p_creator and x.status = 'selected' and c.status = 'active'),
    'completed', (select count(*) from public.campaign_creators where creator_id = p_creator and status = 'completed'),
    'earned', (select coalesce(sum(agreed_amount), 0) from public.campaign_creators where creator_id = p_creator and payment_status = 'paid'),
    'earned_in_range', (select coalesce(sum(agreed_amount), 0) from public.campaign_creators where creator_id = p_creator and payment_status = 'paid'
                        and paid_at >= p_from::timestamptz and paid_at < (p_to + 1)::timestamptz),
    'pending_payments', (select coalesce(sum(agreed_amount), 0) from public.campaign_creators where creator_id = p_creator and payment_status = 'pending' and agreed_amount is not null),
    'rows', coalesce((select jsonb_agg(to_jsonb(pl) order by pl.last_activity desc nulls last) from (select * from pipeline order by last_activity desc nulls last limit 12) pl), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Evidence for AI insights — every number here is a real count; the AI only phrases and ranks.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_ai_evidence(p_creator uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.dashboard_assert(p_creator);
  with my_posts as (select * from public.posts where creator_id = p_creator and not is_removed),
  my_campaigns as (
    select c.* from public.campaigns c where exists (select 1 from public.campaign_applications a where a.campaign_id = c.id and a.creator_id = p_creator and a.status <> 'withdrawn')
       or exists (select 1 from public.campaign_creators x where x.campaign_id = c.id and x.creator_id = p_creator)),
  areas as (
    select 'category:' || cat.slug id, 'category' kind, cat.name label,
      (select count(*) from my_posts p where p.category_id = cat.id) posts,
      (select count(*) from my_campaigns c where c.category_id = cat.id) campaigns,
      (select count(*) from my_posts p where p.category_id = cat.id and jsonb_array_length(p.workflow_steps) > 0) workflows
    from public.categories cat
    union all
    select 'content_type:' || ct.slug, 'content_type', ct.name,
      (select count(*) from my_posts p where p.content_type_id = ct.id),
      (select count(*) from my_campaigns c where c.content_type_id = ct.id),
      (select count(*) from my_posts p where p.content_type_id = ct.id and jsonb_array_length(p.workflow_steps) > 0)
    from public.content_types ct
    union all
    select 'style:' || st.slug, 'style', st.name,
      (select count(*) from my_posts p where p.style_id = st.id),
      (select count(*) from my_campaigns c where c.style_id = st.id),
      (select count(*) from my_posts p where p.style_id = st.id and jsonb_array_length(p.workflow_steps) > 0)
    from public.styles st
    union all
    select 'tool:' || t.slug, 'tool', t.name,
      (select count(*) from my_posts p join public.post_tools pt on pt.post_id = p.id where pt.tool_id = t.id),
      (select count(*) from my_campaigns c join public.campaign_tools ctl on ctl.campaign_id = c.id where ctl.tool_id = t.id),
      (select count(*) from my_posts p where exists (select 1 from jsonb_array_elements(p.workflow_steps) w where (w->>'tool_id')::int = t.id))
    from public.ai_tools t
  ),
  demand as (
    select 'tool:' || t.slug id, t.name label, count(*) n from public.campaigns c join public.campaign_tools x on x.campaign_id = c.id join public.ai_tools t on t.id = x.tool_id
      where c.status = 'active' and c.brand_id <> p_creator group by 1, 2
    union all select 'content_type:' || ct.slug, ct.name, count(*) from public.campaigns c join public.content_types ct on ct.id = c.content_type_id where c.status = 'active' group by 1, 2
    union all select 'style:' || st.slug, st.name, count(*) from public.campaigns c join public.styles st on st.id = c.style_id where c.status = 'active' group by 1, 2
    union all select 'category:' || cat.slug, cat.name, count(*) from public.campaigns c join public.categories cat on cat.id = c.category_id where c.status = 'active' group by 1, 2
  )
  select jsonb_build_object(
    'posts', (select count(*) from my_posts),
    'workflow_posts', (select count(*) from my_posts where jsonb_array_length(workflow_steps) > 0),
    'campaigns', (select count(*) from my_campaigns),
    'hired', (select count(*) from public.campaign_creators where creator_id = p_creator),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'label', label, 'posts', posts, 'campaigns', campaigns, 'workflows', workflows)
                                        order by posts + campaigns * 2 desc) from areas where posts + campaigns > 0), '[]'::jsonb),
    'demand', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'campaigns', n) order by n desc) from demand), '[]'::jsonb),
    'active_campaigns', (select count(*) from public.campaigns where status = 'active'),
    'opportunities', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.campaign->>'id', 'title', o.campaign->>'title',
               'brand', o.campaign->'brand'->>'display_name', 'score', o.score, 'reasons', o.reasons) order by o.score desc)
      from public.get_opportunities('for_you', 6, 0) o), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Demo history generator (service role only). Touches only rows it generated (source = 'seed')
-- and timestamps of interactions between demo accounts.
-- ---------------------------------------------------------------------------
create or replace function public.seed_dashboard_history(
  p_creator uuid, p_demo_ids uuid[], p_base numeric, p_spike_days_ago int, p_dip_from int, p_dip_to int)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.post_views where creator_id = p_creator and source = 'seed';
  delete from public.profile_visits where creator_id = p_creator and source = 'seed';

  -- Daily view volume: weekly rhythm × slow growth × noise × viral spike × dip
  with days as (
    select d, (current_date - d) ago,
      greatest(0, round(p_base
        * case extract(isodow from current_date - d) when 6 then 1.3 when 7 then 1.25 when 1 then 0.85 else 1 end
        * (0.7 + 0.6 * (89 - d) / 89.0)
        * (0.75 + 0.5 * ((abs(hashtext(p_creator::text || d::text)) % 1000) / 1000.0))
        * case when d between p_spike_days_ago - 3 and p_spike_days_ago then 4.5 - (p_spike_days_ago - d) * 0.9 else 1 end
        * case when d between p_dip_from and p_dip_to then 0.45 else 1 end))::int n
    from generate_series(0, 89) d
  ),
  slots as (
    select days.d, days.ago, g.i, abs(hashtext(p_creator::text || days.d::text || g.i::text)) h
    from days cross join lateral generate_series(1, days.n) g(i)
  ),
  candidates as (
    -- posts live on that day, weighted towards popular and recent work
    select s.d, s.i, s.h, p.id post_id, p.media_type,
      row_number() over (partition by s.d, s.i order by (abs(hashtext(p.id::text || s.h::text)) % 1000) / (1 + p.likes_count + p.saves_count * 2)::float) rk
    from slots s join public.posts p on p.creator_id = p_creator and not p.is_removed
      and p.created_at::date <= current_date - s.d
  )
  insert into public.post_views (post_id, creator_id, viewer_id, watch_duration, source, created_at)
  select c.post_id, p_creator,
    case when c.h % 100 < 4 then p_demo_ids[1 + (c.h / 100) % array_length(p_demo_ids, 1)] end,
    case when c.media_type = 'video' then 2000 + c.h % 23000 else 900 + c.h % 7000 end,
    'seed',
    (current_date - c.d)::timestamptz + ((c.h % 86000) || ' seconds')::interval
  from candidates c where c.rk = 1;

  -- Profile visits ≈ 12% of daily views (+ noise)
  insert into public.profile_visits (creator_id, visitor_id, source, created_at)
  select p_creator,
    case when abs(hashtext(p_creator::text || 'v' || d::text || g.i::text)) % 100 < 6
         then p_demo_ids[1 + abs(hashtext(d::text || g.i::text)) % array_length(p_demo_ids, 1)] end,
    'seed',
    (current_date - d)::timestamptz + ((abs(hashtext(p_creator::text || d::text || g.i::text)) % 86000) || ' seconds')::interval
  from generate_series(0, 89) d
  cross join lateral generate_series(1, greatest(0, (
    select count(*) from public.post_views v where v.creator_id = p_creator and v.source = 'seed'
      and (v.created_at at time zone 'utc')::date = current_date - d) * 12 / 100
      + abs(hashtext(p_creator::text || 'pv' || d::text)) % 3)::int) g(i);

  -- Spread interactions between demo accounts across the creator's history (never before the post existed)
  update public.follows f set created_at = now() - ((5 + abs(hashtext(f.follower_id::text || f.following_id::text)) % 84) || ' days')::interval
    where f.following_id = p_creator and f.follower_id = any(p_demo_ids);
  update public.likes l set created_at = p.created_at + (now() - p.created_at) * ((abs(hashtext(l.user_id::text || l.post_id::text)) % 1000) / 1000.0)
    from public.posts p where p.id = l.post_id and p.creator_id = p_creator and l.user_id = any(p_demo_ids);
  update public.saves s set created_at = p.created_at + (now() - p.created_at) * ((abs(hashtext('s' || s.user_id::text || s.post_id::text)) % 1000) / 1000.0)
    from public.posts p where p.id = s.post_id and p.creator_id = p_creator and s.user_id = any(p_demo_ids);
  update public.comments c set created_at = p.created_at + (now() - p.created_at) * ((abs(hashtext('c' || c.id::text)) % 1000) / 1000.0)
    from public.posts p where p.id = c.post_id and p.creator_id = p_creator and c.user_id = any(p_demo_ids);
  update public.campaign_applications a set created_at = now() - ((3 + abs(hashtext(a.id::text)) % 50) || ' days')::interval
    where a.creator_id = p_creator;
  update public.campaign_shortlists s set created_at = now() - ((1 + abs(hashtext(s.campaign_id::text || s.creator_id::text)) % 20) || ' days')::interval
    where s.creator_id = p_creator;
end $$;

revoke execute on function public.seed_dashboard_history(uuid, uuid[], numeric, int, int, int) from public, anon, authenticated;
grant execute on function public.seed_dashboard_history(uuid, uuid[], numeric, int, int, int) to service_role;
revoke execute on function public.dashboard_assert(uuid) from public, anon;
