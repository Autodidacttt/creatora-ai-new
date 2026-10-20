-- 0013: reels-style creator viewer signals.
--  * New interaction actions: skip (moved on without engaging), navigate (prev/next arrows),
--    watch (time spent on a post, context.ms) and comment.
--  * get_swipe_deck: a creator counts as "seen" once the viewer moved past them; p_include_seen
--    lets the viewer start over ("Reset"). Long watches now feed tool affinity.
-- Backwards compatible: existing callers (p_campaign_id, p_limit) keep working.

alter table public.interactions drop constraint interactions_action_check;
alter table public.interactions add constraint interactions_action_check check (action in (
  'view','like','save','follow','swipe_left','swipe_right','contact','ignore','apply','shortlist',
  'skip','navigate','watch','comment'));

create index if not exists interactions_seen_idx on public.interactions(user_id, target_id)
  where target_type = 'profile';

-- Has the current user already moved past this creator?
create or replace function public.creator_seen(p_creator uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.interactions i
    where i.user_id = auth.uid() and i.target_type = 'profile' and i.target_id = p_creator
      and (i.action in ('swipe_left', 'swipe_right', 'skip')
           or (i.action = 'navigate' and i.context->>'direction' = 'next')));
$$;

drop function if exists public.get_swipe_deck(uuid, int);

create or replace function public.get_swipe_deck(
  p_campaign_id uuid default null, p_limit int default 15, p_include_seen boolean default false)
returns table (creator jsonb, score int, reasons text[], campaign_id uuid)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare
  v_campaign uuid := p_campaign_id;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if v_campaign is null and public.current_app_role() = 'brand' then
    select c.id into v_campaign from public.campaigns c
    where c.brand_id = v_uid and c.status = 'active'
    order by c.created_at desc limit 1;
  end if;

  if v_campaign is not null then
    return query
      select r.creator, r.score, r.reasons, v_campaign
      from public.rank_creators_for_campaign(v_campaign, 60, 0, false) r
      where p_include_seen or not public.creator_seen((r.creator->>'id')::uuid)
      order by r.score desc
      limit greatest(least(p_limit, 40), 1);
    return;
  end if;

  return query
  with my_tools as (
    select tool_id from public.creator_tools where creator_id = v_uid
    union select pt.tool_id from public.likes l join public.post_tools pt on pt.post_id = l.post_id where l.user_id = v_uid
    union select pt.tool_id from public.saves sv join public.post_tools pt on pt.post_id = sv.post_id where sv.user_id = v_uid
    union select pt.tool_id from public.interactions i join public.post_tools pt on pt.post_id = i.target_id
          where i.user_id = v_uid and i.target_type = 'post' and i.action = 'watch'
            and coalesce((i.context->>'ms')::int, 0) >= 3000
  ),
  my_cats as (
    select category_id from public.creator_categories where creator_id = v_uid
    union select po.category_id from public.likes l join public.posts po on po.id = l.post_id
          where l.user_id = v_uid and po.category_id is not null
  ),
  cand as (
    select p.id, p.is_verified, coalesce(st.followers_count, 0) as followers,
      array(select t.name from public.creator_tools ct join public.ai_tools t on t.id = ct.tool_id
            where ct.creator_id = p.id and ct.tool_id in (select tool_id from my_tools) order by t.sort, t.name) as shared_tools,
      array(select c.name from public.creator_categories cc join public.categories c on c.id = cc.category_id
            where cc.creator_id = p.id and cc.category_id in (select category_id from my_cats) order by c.sort) as shared_cats,
      (select count(*) from public.posts po where po.creator_id = p.id and not po.is_removed) as n_posts,
      (select max(po.created_at) from public.posts po where po.creator_id = p.id and not po.is_removed) as last_post
    from public.profiles p
    left join public.profile_stats st on st.profile_id = p.id
    where p.role = 'creator' and not p.is_suspended and p.id <> v_uid
      and (p_include_seen or not public.creator_seen(p.id))
      and (p_include_seen or not exists (select 1 from public.follows f where f.follower_id = v_uid and f.following_id = p.id))
  ),
  scored as (
    select cand.*,
      least(100, round(
          least(cardinality(shared_tools), 4) * 10
        + least(cardinality(shared_cats), 2) * 12
        + least(ln(1 + followers) * 5, 15)
        + case when is_verified then 10 else 0 end
        + least(n_posts, 6) * 2
        + case when last_post > now() - interval '30 days' then 9 else 0 end))::int as sc,
      array_remove(array[
        case when cardinality(shared_tools) > 0 then
          format('Shares your tools: %s', array_to_string(shared_tools[1:3], ', ')) end,
        case when cardinality(shared_cats) > 0 then
          format('Works in %s', array_to_string(shared_cats[1:2], ' & ')) end,
        case when is_verified then 'Verified creator' end,
        case when n_posts > 0 then format('%s portfolio piece%s', n_posts, case when n_posts = 1 then '' else 's' end) end,
        case when last_post > now() - interval '30 days' then 'Posted recently' end,
        case when followers > 0 then format('%s follower%s', followers, case when followers = 1 then '' else 's' end) end
      ], null) as why
    from cand
  )
  select public.creator_card(scored.id), scored.sc, scored.why, null::uuid
  from scored
  order by scored.sc desc, scored.id
  limit greatest(least(p_limit, 40), 1);
end $$;

grant execute on function public.get_swipe_deck(uuid, int, boolean) to anon, authenticated, service_role;
grant execute on function public.creator_seen(uuid) to anon, authenticated, service_role;
