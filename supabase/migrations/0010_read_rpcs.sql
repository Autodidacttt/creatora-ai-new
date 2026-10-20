-- 0010: list/read RPCs used by the app (return ready-to-render JSON, RLS applies)

create or replace function public.mini_profile(p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
    'avatar_url', p.avatar_url, 'is_verified', p.is_verified, 'headline', p.headline, 'role', p.role)
  from public.profiles p where p.id = p_id;
$$;

create or replace function public.get_post(p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select public.post_card(p.id) from public.posts p where p.id = p_id;   -- RLS hides removed posts
$$;

create or replace function public.get_creator_posts(p_creator uuid, p_limit int default 24, p_offset int default 0)
returns table (post jsonb, total_count bigint)
language sql stable set search_path = public as $$
  with page as (
    select p.id, p.created_at, count(*) over () as total
    from public.posts p
    where p.creator_id = p_creator and not p.is_removed
    order by p.created_at desc, p.id
    limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0)
  )
  select public.post_card(page.id), page.total from page order by page.created_at desc, page.id;
$$;

create or replace function public.get_saved_posts(p_limit int default 24, p_offset int default 0)
returns table (post jsonb, total_count bigint)
language sql stable set search_path = public as $$
  with page as (
    select s.post_id, s.created_at, count(*) over () as total
    from public.saves s join public.posts p on p.id = s.post_id and not p.is_removed
    where s.user_id = auth.uid()
    order by s.created_at desc
    limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0)
  )
  select public.post_card(page.post_id), page.total from page order by page.created_at desc;
$$;

create or replace function public.get_comments(p_post uuid, p_limit int default 50, p_offset int default 0)
returns table (id uuid, body text, created_at timestamptz, author jsonb, total_count bigint)
language sql stable set search_path = public as $$
  select c.id, c.body, c.created_at, public.mini_profile(c.user_id), count(*) over ()
  from public.comments c
  where c.post_id = p_post
  order by c.created_at asc
  limit greatest(least(p_limit, 100), 1) offset greatest(p_offset, 0);
$$;

create or replace function public.get_notifications(p_limit int default 20, p_offset int default 0)
returns table (id uuid, type text, entity_type text, entity_id uuid, data jsonb, read_at timestamptz,
               created_at timestamptz, actor jsonb, total_count bigint)
language sql stable set search_path = public as $$
  select n.id, n.type, n.entity_type, n.entity_id, n.data, n.read_at, n.created_at,
         case when n.actor_id is null then null else public.mini_profile(n.actor_id) end,
         count(*) over ()
  from public.notifications n
  where n.user_id = auth.uid()
  order by n.created_at desc
  limit greatest(least(p_limit, 50), 1) offset greatest(p_offset, 0);
$$;

create or replace function public.get_follow_list(p_user uuid, p_kind text default 'followers',
  p_limit int default 30, p_offset int default 0)
returns table (profile jsonb, is_following boolean, total_count bigint)
language sql stable set search_path = public as $$
  select public.mini_profile(x.pid),
         exists (select 1 from public.follows f2 where f2.follower_id = auth.uid() and f2.following_id = x.pid),
         count(*) over ()
  from (
    select case when p_kind = 'following' then f.following_id else f.follower_id end as pid, f.created_at
    from public.follows f
    where (p_kind = 'following' and f.follower_id = p_user) or (p_kind <> 'following' and f.following_id = p_user)
  ) x
  order by x.created_at desc
  limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0);
$$;

create or replace function public.get_campaign(p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select public.campaign_card(c.id) from public.campaigns c where c.id = p_id;   -- RLS hides others' drafts
$$;

create or replace function public.get_brand_campaigns(p_brand uuid default null, p_status text default null,
  p_limit int default 30, p_offset int default 0)
returns table (campaign jsonb, total_count bigint)
language sql stable set search_path = public as $$
  with page as (
    select c.id, c.created_at, count(*) over () as total,
           case c.status when 'active' then 0 when 'draft' then 1 else 2 end as rank
    from public.campaigns c
    where c.brand_id = coalesce(p_brand, auth.uid())
      and (p_status is null or c.status = p_status)
    order by rank, c.created_at desc
    limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0)
  )
  select public.campaign_card(page.id), page.total from page
  order by page.rank, page.created_at desc;
$$;

-- Applications for a brand's campaign, with applicant card and pipeline state
create or replace function public.get_campaign_applications(p_campaign uuid)
returns table (id uuid, pitch text, proposed_rate int, status text, created_at timestamptz,
               creator jsonb, shortlisted boolean, selected boolean)
language sql stable set search_path = public as $$
  select a.id, a.pitch, a.proposed_rate, a.status, a.created_at, public.creator_card(a.creator_id),
    exists (select 1 from public.campaign_shortlists s where s.campaign_id = a.campaign_id and s.creator_id = a.creator_id),
    exists (select 1 from public.campaign_creators s where s.campaign_id = a.campaign_id and s.creator_id = a.creator_id)
  from public.campaign_applications a
  where a.campaign_id = p_campaign and a.status <> 'withdrawn'
  order by a.created_at desc;
$$;

-- Shortlisted / selected creators (whether or not they applied)
create or replace function public.get_campaign_pipeline(p_campaign uuid)
returns table (creator jsonb, stage text, note text, created_at timestamptz, applied boolean)
language sql stable set search_path = public as $$
  select public.creator_card(s.creator_id), 'shortlisted', s.note, s.created_at,
         exists (select 1 from public.campaign_applications a where a.campaign_id = s.campaign_id
                 and a.creator_id = s.creator_id and a.status <> 'withdrawn')
  from public.campaign_shortlists s where s.campaign_id = p_campaign
  union all
  select public.creator_card(x.creator_id), x.status, null, x.created_at,
         exists (select 1 from public.campaign_applications a where a.campaign_id = x.campaign_id
                 and a.creator_id = x.creator_id and a.status <> 'withdrawn')
  from public.campaign_creators x where x.campaign_id = p_campaign
  order by 4 desc;
$$;

-- Lightweight public counters for the landing page
create or replace function public.public_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'creators', (select count(*) from public.profiles where role = 'creator' and not is_suspended),
    'brands', (select count(*) from public.profiles where role = 'brand' and not is_suspended),
    'posts', (select count(*) from public.posts where not is_removed),
    'active_briefs', (select count(*) from public.campaigns where status = 'active'),
    'tools', (select count(distinct tool_id) from public.creator_tools));
$$;

-- ---------------------------------------------------------------------------
-- Admin lists (security definer + explicit admin check)
-- ---------------------------------------------------------------------------
create or replace function public.assert_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
end $$;

create or replace function public.admin_list_users(p_query text default null, p_role text default null,
  p_limit int default 30, p_offset int default 0)
returns table (id uuid, role text, username text, display_name text, avatar_url text, email text,
               is_verified boolean, is_suspended boolean, created_at timestamptz, followers int, posts int,
               pending_verifications int, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return query
  select p.id, p.role, p.username::text, p.display_name, p.avatar_url, u.email::text, p.is_verified, p.is_suspended,
         p.created_at, coalesce(s.followers_count, 0), coalesce(s.posts_count, 0),
         (select count(*) from public.verifications v where v.creator_id = p.id and v.status = 'pending')::int,
         count(*) over ()
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.profile_stats s on s.profile_id = p.id
  where (p_role is null or p.role = p_role)
    and (nullif(trim(p_query), '') is null or p.display_name ilike '%' || trim(p_query) || '%'
         or p.username::text ilike '%' || trim(p_query) || '%' or u.email ilike '%' || trim(p_query) || '%')
  order by p.created_at desc
  limit greatest(least(p_limit, 100), 1) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_list_posts(p_query text default null, p_removed boolean default null,
  p_limit int default 30, p_offset int default 0)
returns table (post jsonb, reports int, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return query
  with page as (
    select p.id, p.created_at, count(*) over () as total
    from public.posts p
    where (p_removed is null or p.is_removed = p_removed)
      and (nullif(trim(p_query), '') is null or p.title ilike '%' || trim(p_query) || '%')
    order by p.created_at desc
    limit greatest(least(p_limit, 100), 1) offset greatest(p_offset, 0)
  )
  select public.post_card(page.id),
         (select count(*) from public.reports r where r.target_type = 'post' and r.target_id = page.id)::int,
         page.total
  from page order by page.created_at desc;
end $$;

create or replace function public.admin_list_verifications(p_status text default 'pending')
returns table (id uuid, type text, title text, status text, evidence_url text, evidence_notes text,
               created_at timestamptz, reviewed_at timestamptz, creator jsonb, subject text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return query
  select v.id, v.type, v.title, v.status, v.evidence_url, v.evidence_notes, v.created_at, v.reviewed_at,
         public.mini_profile(v.creator_id),
         coalesce((select t.name from public.ai_tools t where t.id = v.tool_id),
                  (select po.title from public.posts po where po.id = v.post_id),
                  (select e.brand_name || ' — ' || e.project_title from public.creator_experiences e where e.id = v.experience_id),
                  'Identity')
  from public.verifications v
  where p_status is null or v.status = p_status
  order by v.created_at desc;
end $$;

create or replace function public.admin_list_reports(p_status text default 'open')
returns table (id uuid, target_type text, target_id uuid, reason text, details text, status text,
               created_at timestamptz, reporter jsonb, target_label text, target_removed boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return query
  select r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
         public.mini_profile(r.reporter_id),
         case r.target_type
           when 'post' then (select po.title from public.posts po where po.id = r.target_id)
           when 'profile' then (select pr.display_name from public.profiles pr where pr.id = r.target_id)
           when 'campaign' then (select c.title from public.campaigns c where c.id = r.target_id)
           when 'comment' then (select left(c.body, 80) from public.comments c where c.id = r.target_id)
           else null end,
         case when r.target_type = 'post' then (select po.is_removed from public.posts po where po.id = r.target_id) end
  from public.reports r
  where p_status is null or r.status = p_status
  order by r.created_at desc;
end $$;

create or replace function public.admin_list_campaigns(p_status text default null)
returns table (campaign jsonb, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return query
  select public.campaign_card(c.id), count(*) over ()
  from public.campaigns c
  where p_status is null or c.status = p_status
  order by c.created_at desc
  limit 100;
end $$;

create or replace function public.admin_audit_log(p_limit int default 50)
returns table (id bigint, action text, target_type text, target_id text, meta jsonb, created_at timestamptz, actor jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return query
  select a.id, a.action, a.target_type, a.target_id, a.meta, a.created_at,
         case when a.actor_id is null then null else public.mini_profile(a.actor_id) end
  from public.audit_logs a
  order by a.created_at desc
  limit greatest(least(p_limit, 200), 1);
end $$;

revoke execute on function public.admin_list_users(text, text, int, int) from anon;
revoke execute on function public.admin_list_posts(text, boolean, int, int) from anon;
revoke execute on function public.admin_list_verifications(text) from anon;
revoke execute on function public.admin_list_reports(text) from anon;
revoke execute on function public.admin_list_campaigns(text) from anon;
revoke execute on function public.admin_audit_log(int) from anon;
revoke execute on function public.admin_stats() from anon;
