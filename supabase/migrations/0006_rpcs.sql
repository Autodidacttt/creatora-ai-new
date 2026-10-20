-- 0006: read models and ranking RPCs. All are SECURITY INVOKER unless noted,
-- so RLS still decides what each caller can see.

-- ---------------------------------------------------------------------------
-- Card builders
-- ---------------------------------------------------------------------------
create or replace function public.creator_card(p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'headline', p.headline,
    'location', p.location,
    'is_verified', p.is_verified,
    'experience_level', cd.experience_level,
    'availability', cd.availability,
    'followers_count', coalesce(s.followers_count, 0),
    'posts_count', coalesce(s.posts_count, 0),
    'likes_count', coalesce(s.likes_received_count, 0),
    'tools', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
               'verified', exists (select 1 from public.verifications v
                                   where v.creator_id = p.id and v.type = 'tool'
                                     and v.tool_id = t.id and v.status = 'approved'))
             order by t.sort, t.name)
      from public.creator_tools ct join public.ai_tools t on t.id = ct.tool_id
      where ct.creator_id = p.id), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name) order by k.sort, k.name)
      from public.creator_skills cs join public.skills k on k.id = cs.skill_id
      where cs.creator_id = p.id), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, c.name)
      from public.creator_categories cc join public.categories c on c.id = cc.category_id
      where cc.creator_id = p.id), '[]'::jsonb),
    'verified_count', (select count(*) from public.verifications v
                       where v.creator_id = p.id and v.status = 'approved'),
    'preview', coalesce((
      select jsonb_agg(q.item order by q.ord)
      from (
        select row_number() over (order by po.likes_count desc, po.created_at desc) as ord,
               jsonb_build_object('id', po.id, 'media_type', po.media_type,
                 'url', coalesce(po.thumbnail_url, po.media_url), 'title', po.title,
                 'aspect_ratio', po.aspect_ratio) as item
        from public.posts po
        where po.creator_id = p.id and not po.is_removed
        order by po.likes_count desc, po.created_at desc
        limit 4
      ) q), '[]'::jsonb),
    'is_following', exists (select 1 from public.follows f
                            where f.follower_id = auth.uid() and f.following_id = p.id)
  )
  from public.profiles p
  left join public.creator_details cd on cd.profile_id = p.id
  left join public.profile_stats s on s.profile_id = p.id
  where p.id = p_id;
$$;

create or replace function public.post_card(p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'description', p.description,
    'media_type', p.media_type,
    'media_url', p.media_url,
    'thumbnail_url', p.thumbnail_url,
    'source_link', p.source_link,
    'embed_provider', p.embed_provider,
    'aspect_ratio', p.aspect_ratio,
    'commercial_use_cleared', p.commercial_use_cleared,
    'workflow_notes', p.workflow_notes,
    'workflow_steps', coalesce((
      select jsonb_agg(jsonb_build_object('tool_id', t.id, 'tool', t.name, 'step', w.e->>'step')
             order by w.ord)
      from jsonb_array_elements(p.workflow_steps) with ordinality as w(e, ord)
      left join public.ai_tools t on t.id = nullif(w.e->>'tool_id', '')::int), '[]'::jsonb),
    'likes_count', p.likes_count,
    'comments_count', p.comments_count,
    'saves_count', p.saves_count,
    'is_removed', p.is_removed,
    'created_at', p.created_at,
    'content_type', (select jsonb_build_object('id', x.id, 'name', x.name)
                     from public.content_types x where x.id = p.content_type_id),
    'style', (select jsonb_build_object('id', x.id, 'name', x.name)
              from public.styles x where x.id = p.style_id),
    'category', (select jsonb_build_object('id', x.id, 'name', x.name)
                 from public.categories x where x.id = p.category_id),
    'tools', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.sort, t.name)
      from public.post_tools pt join public.ai_tools t on t.id = pt.tool_id
      where pt.post_id = p.id), '[]'::jsonb),
    'creator', jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name,
                 'avatar_url', u.avatar_url, 'is_verified', u.is_verified, 'headline', u.headline),
    'liked', exists (select 1 from public.likes l where l.post_id = p.id and l.user_id = auth.uid()),
    'saved', exists (select 1 from public.saves s where s.post_id = p.id and s.user_id = auth.uid()),
    'workflow_verified', exists (select 1 from public.verifications v
                                 where v.post_id = p.id and v.type = 'workflow' and v.status = 'approved')
  )
  from public.posts p
  join public.profiles u on u.id = p.creator_id
  where p.id = p_id;
$$;

create or replace function public.campaign_card(p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select to_jsonb(c) - 'search' || jsonb_build_object(
    'brand', jsonb_build_object('id', b.id, 'username', b.username, 'display_name', b.display_name,
               'avatar_url', b.avatar_url, 'is_verified', b.is_verified,
               'company_name', bd.company_name, 'industry', bd.industry),
    'content_type', (select jsonb_build_object('id', x.id, 'name', x.name)
                     from public.content_types x where x.id = c.content_type_id),
    'style', (select jsonb_build_object('id', x.id, 'name', x.name) from public.styles x where x.id = c.style_id),
    'category', (select jsonb_build_object('id', x.id, 'name', x.name) from public.categories x where x.id = c.category_id),
    'platforms', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort)
                  from public.campaign_platforms j join public.platforms x on x.id = j.platform_id
                  where j.campaign_id = c.id), '[]'::jsonb),
    'tools', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
              from public.campaign_tools j join public.ai_tools x on x.id = j.tool_id
              where j.campaign_id = c.id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
               from public.campaign_skills j join public.skills x on x.id = j.skill_id
               where j.campaign_id = c.id), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort)
                  from public.campaign_languages j join public.languages x on x.id = j.language_id
                  where j.campaign_id = c.id), '[]'::jsonb),
    'stats', (select jsonb_build_object('applications', st.applications_count,
                'shortlisted', st.shortlisted_count, 'selected', st.selected_count)
              from public.campaign_stats st where st.campaign_id = c.id),
    'my_application', (select jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at)
                       from public.campaign_applications a
                       where a.campaign_id = c.id and a.creator_id = auth.uid()),
    'my_shortlisted', exists (select 1 from public.campaign_shortlists s
                              where s.campaign_id = c.id and s.creator_id = auth.uid()),
    'my_selected', exists (select 1 from public.campaign_creators s
                           where s.campaign_id = c.id and s.creator_id = auth.uid()),
    'saved', exists (select 1 from public.saved_opportunities so
                     where so.campaign_id = c.id and so.creator_id = auth.uid())
  )
  from public.campaigns c
  join public.profiles b on b.id = c.brand_id
  left join public.brand_details bd on bd.profile_id = b.id
  where c.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- Full profile read model
-- ---------------------------------------------------------------------------
create or replace function public.get_profile(p_username text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'role', p.role, 'username', p.username, 'display_name', p.display_name,
    'avatar_url', p.avatar_url, 'cover_url', p.cover_url, 'headline', p.headline, 'bio', p.bio,
    'location', p.location, 'website', p.website, 'links', p.links,
    'is_verified', p.is_verified, 'is_suspended', p.is_suspended, 'onboarded', p.onboarded,
    'created_at', p.created_at,
    'stats', jsonb_build_object(
      'followers', coalesce(s.followers_count, 0), 'following', coalesce(s.following_count, 0),
      'posts', coalesce(s.posts_count, 0), 'likes', coalesce(s.likes_received_count, 0)),
    'creator', (select jsonb_build_object('experience_level', cd.experience_level,
                  'availability', cd.availability, 'years_experience', cd.years_experience,
                  'rate_min', cd.rate_min, 'rate_max', cd.rate_max, 'currency', cd.currency,
                  'workflow_overview', cd.workflow_overview)
                from public.creator_details cd where cd.profile_id = p.id),
    'brand', (select jsonb_build_object('company_name', bd.company_name, 'industry', bd.industry,
                'company_size', bd.company_size, 'description', bd.description)
              from public.brand_details bd where bd.profile_id = p.id),
    'tools', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category,
               'proficiency', ct.proficiency,
               'verified', exists (select 1 from public.verifications v
                                   where v.creator_id = p.id and v.type = 'tool'
                                     and v.tool_id = t.id and v.status = 'approved'))
             order by t.sort, t.name)
      from public.creator_tools ct join public.ai_tools t on t.id = ct.tool_id
      where ct.creator_id = p.id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
               from public.creator_skills j join public.skills x on x.id = j.skill_id
               where j.creator_id = p.id), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
                   from public.creator_categories j join public.categories x on x.id = j.category_id
                   where j.creator_id = p.id), '[]'::jsonb),
    'content_types', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
                      from public.creator_content_types j join public.content_types x on x.id = j.content_type_id
                      where j.creator_id = p.id), '[]'::jsonb),
    'styles', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
               from public.creator_styles j join public.styles x on x.id = j.style_id
               where j.creator_id = p.id), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
                  from public.creator_languages j join public.languages x on x.id = j.language_id
                  where j.creator_id = p.id), '[]'::jsonb),
    'platforms', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
                  from public.creator_platforms j join public.platforms x on x.id = j.platform_id
                  where j.creator_id = p.id), '[]'::jsonb),
    'experiences', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'brand_name', e.brand_name,
               'project_title', e.project_title, 'year', e.year, 'description', e.description,
               'link', e.link,
               'verified', exists (select 1 from public.verifications v
                                   where v.experience_id = e.id and v.status = 'approved'))
             order by e.year desc nulls last, e.created_at desc)
      from public.creator_experiences e where e.creator_id = p.id), '[]'::jsonb),
    'verifications', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'type', v.type, 'title', v.title,
               'status', v.status, 'evidence_url', v.evidence_url, 'evidence_notes', v.evidence_notes,
               'tool_id', v.tool_id, 'post_id', v.post_id, 'experience_id', v.experience_id,
               'reviewed_at', v.reviewed_at, 'created_at', v.created_at)
             order by v.created_at desc)
      from public.verifications v where v.creator_id = p.id), '[]'::jsonb),
    'is_me', p.id = auth.uid(),
    'is_following', exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.id),
    'follows_you', exists (select 1 from public.follows f where f.follower_id = p.id and f.following_id = auth.uid())
  )
  from public.profiles p
  left join public.profile_stats s on s.profile_id = p.id
  where p.username = p_username::extensions.citext;
$$;

-- ---------------------------------------------------------------------------
-- Creator search
-- ---------------------------------------------------------------------------
-- Per-creator match flags. NULL means "filter group not active".
create or replace function public.creator_search_flags(
  p_query text, p_skills int[], p_categories int[], p_tools int[], p_content_types int[],
  p_styles int[], p_experience text[], p_availability text[], p_languages int[], p_verified_only boolean)
returns table (
  id uuid, text_score real, followers int, created_at timestamptz,
  m_query boolean, m_skills boolean, m_categories boolean, m_tools boolean, m_content_types boolean,
  m_styles boolean, m_experience boolean, m_availability boolean, m_languages boolean, m_verified boolean,
  overlap int)
language sql stable set search_path = public, extensions as $$
  with params as (
    select q, case when q is null then null else websearch_to_tsquery('simple', q) end as tsq,
           case when q is null then null
                else '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' end as pat
    from (select nullif(trim(p_query), '') as q) x
  )
  select
    p.id,
    (case when pr.q is null then 0
          else ts_rank(p.search, pr.tsq) * 2 + similarity(p.display_name, pr.q) end)::real,
    coalesce(s.followers_count, 0),
    p.created_at,
    case when pr.q is null then null else (
         p.search @@ pr.tsq
      or p.display_name ilike pr.pat
      or p.username::text ilike pr.pat
      or exists (select 1 from public.posts po where po.creator_id = p.id and not po.is_removed
                   and (po.search @@ websearch_to_tsquery('english', pr.q) or po.title ilike pr.pat))
      or exists (select 1 from public.creator_tools ct join public.ai_tools t on t.id = ct.tool_id
                   where ct.creator_id = p.id and t.name ilike pr.pat)
      or exists (select 1 from public.creator_skills cs join public.skills k on k.id = cs.skill_id
                   where cs.creator_id = p.id and k.name ilike pr.pat)
      or exists (select 1 from public.creator_categories cc join public.categories c on c.id = cc.category_id
                   where cc.creator_id = p.id and c.name ilike pr.pat)
    ) end,
    case when coalesce(cardinality(p_skills), 0) = 0 then null else exists (
      select 1 from public.creator_skills x where x.creator_id = p.id and x.skill_id = any(p_skills)) end,
    case when coalesce(cardinality(p_categories), 0) = 0 then null else exists (
      select 1 from public.creator_categories x where x.creator_id = p.id and x.category_id = any(p_categories)) end,
    case when coalesce(cardinality(p_tools), 0) = 0 then null else exists (
      select 1 from public.creator_tools x where x.creator_id = p.id and x.tool_id = any(p_tools)) end,
    case when coalesce(cardinality(p_content_types), 0) = 0 then null else (
      exists (select 1 from public.creator_content_types x
              where x.creator_id = p.id and x.content_type_id = any(p_content_types))
      or exists (select 1 from public.posts x
                 where x.creator_id = p.id and not x.is_removed and x.content_type_id = any(p_content_types))) end,
    case when coalesce(cardinality(p_styles), 0) = 0 then null else (
      exists (select 1 from public.creator_styles x where x.creator_id = p.id and x.style_id = any(p_styles))
      or exists (select 1 from public.posts x
                 where x.creator_id = p.id and not x.is_removed and x.style_id = any(p_styles))) end,
    case when coalesce(cardinality(p_experience), 0) = 0 then null else cd.experience_level = any(p_experience) end,
    case when coalesce(cardinality(p_availability), 0) = 0 then null else cd.availability = any(p_availability) end,
    case when coalesce(cardinality(p_languages), 0) = 0 then null else exists (
      select 1 from public.creator_languages x where x.creator_id = p.id and x.language_id = any(p_languages)) end,
    case when coalesce(p_verified_only, false) then p.is_verified else null end,
    ( (select count(*) from public.creator_skills x where x.creator_id = p.id and x.skill_id = any(coalesce(p_skills, '{}')))
    + (select count(*) from public.creator_tools x where x.creator_id = p.id and x.tool_id = any(coalesce(p_tools, '{}')))
    + (select count(*) from public.creator_categories x where x.creator_id = p.id and x.category_id = any(coalesce(p_categories, '{}')))
    + (select count(*) from public.creator_languages x where x.creator_id = p.id and x.language_id = any(coalesce(p_languages, '{}')))
    )::int
  from public.profiles p
  join public.creator_details cd on cd.profile_id = p.id
  left join public.profile_stats s on s.profile_id = p.id
  cross join params pr
  where p.role = 'creator' and not p.is_suspended;
$$;

-- Filters are ANDed across groups and ORed within a group.
-- p_match = 'any' relaxes that to "matches at least one active group" (used for "related creators").
create or replace function public.search_creators(
  p_query text default null,
  p_skills int[] default null,
  p_categories int[] default null,
  p_tools int[] default null,
  p_content_types int[] default null,
  p_styles int[] default null,
  p_experience text[] default null,
  p_availability text[] default null,
  p_languages int[] default null,
  p_verified_only boolean default false,
  p_sort text default 'best',
  p_match text default 'all',
  p_exclude uuid[] default null,
  p_limit int default 24,
  p_offset int default 0)
returns table (creator jsonb, score real, matched_groups int, total_count bigint)
language sql stable set search_path = public as $$
  with f as (
    select * from public.creator_search_flags(p_query, p_skills, p_categories, p_tools, p_content_types,
      p_styles, p_experience, p_availability, p_languages, p_verified_only)
  ),
  g as (
    select f.*,
      ( (f.m_query is true)::int + (f.m_skills is true)::int + (f.m_categories is true)::int
      + (f.m_tools is true)::int + (f.m_content_types is true)::int + (f.m_styles is true)::int
      + (f.m_experience is true)::int + (f.m_availability is true)::int
      + (f.m_languages is true)::int + (f.m_verified is true)::int) as hits,
      ( (f.m_query is not null)::int + (f.m_skills is not null)::int + (f.m_categories is not null)::int
      + (f.m_tools is not null)::int + (f.m_content_types is not null)::int + (f.m_styles is not null)::int
      + (f.m_experience is not null)::int + (f.m_availability is not null)::int
      + (f.m_languages is not null)::int + (f.m_verified is not null)::int) as active
    from f
    where p_exclude is null or f.id <> all(p_exclude)
  ),
  m as (
    select g.*, (g.text_score * 3 + g.hits * 2 + g.overlap * 0.5 + ln(1 + g.followers) * 0.3)::real as sc
    from g
    where case when p_match = 'any' then g.active = 0 or g.hits > 0
          else coalesce(g.m_query, true) and coalesce(g.m_skills, true) and coalesce(g.m_categories, true)
           and coalesce(g.m_tools, true) and coalesce(g.m_content_types, true) and coalesce(g.m_styles, true)
           and coalesce(g.m_experience, true) and coalesce(g.m_availability, true)
           and coalesce(g.m_languages, true) and coalesce(g.m_verified, true) end
  ),
  page as (
    select m.id, m.sc, m.hits, count(*) over () as total,
      case p_sort
        when 'newest' then extract(epoch from m.created_at)::float8
        when 'followers' then m.followers::float8
        else m.sc::float8 end as sort_key
    from m
    order by sort_key desc, m.id
    limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0)
  )
  select public.creator_card(page.id), page.sc, page.hits, page.total
  from page
  order by page.sort_key desc, page.id;
$$;

-- For empty states: how many results each active filter group is costing.
create or replace function public.search_creators_diagnostics(
  p_query text default null,
  p_skills int[] default null,
  p_categories int[] default null,
  p_tools int[] default null,
  p_content_types int[] default null,
  p_styles int[] default null,
  p_experience text[] default null,
  p_availability text[] default null,
  p_languages int[] default null,
  p_verified_only boolean default false)
returns table (filter_group text, results_without bigint)
language sql stable set search_path = public as $$
  with f as (
    select * from public.creator_search_flags(p_query, p_skills, p_categories, p_tools, p_content_types,
      p_styles, p_experience, p_availability, p_languages, p_verified_only)
  ),
  groups as (
    select grp from unnest(array['query','skills','categories','tools','content_types','styles',
                                 'experience','availability','languages','verified']) as grp
    where case grp
      when 'query' then nullif(trim(p_query), '') is not null
      when 'skills' then coalesce(cardinality(p_skills), 0) > 0
      when 'categories' then coalesce(cardinality(p_categories), 0) > 0
      when 'tools' then coalesce(cardinality(p_tools), 0) > 0
      when 'content_types' then coalesce(cardinality(p_content_types), 0) > 0
      when 'styles' then coalesce(cardinality(p_styles), 0) > 0
      when 'experience' then coalesce(cardinality(p_experience), 0) > 0
      when 'availability' then coalesce(cardinality(p_availability), 0) > 0
      when 'languages' then coalesce(cardinality(p_languages), 0) > 0
      when 'verified' then coalesce(p_verified_only, false)
    end
  )
  select groups.grp, (
    select count(*) from f where
          (groups.grp = 'query' or coalesce(f.m_query, true))
      and (groups.grp = 'skills' or coalesce(f.m_skills, true))
      and (groups.grp = 'categories' or coalesce(f.m_categories, true))
      and (groups.grp = 'tools' or coalesce(f.m_tools, true))
      and (groups.grp = 'content_types' or coalesce(f.m_content_types, true))
      and (groups.grp = 'styles' or coalesce(f.m_styles, true))
      and (groups.grp = 'experience' or coalesce(f.m_experience, true))
      and (groups.grp = 'availability' or coalesce(f.m_availability, true))
      and (groups.grp = 'languages' or coalesce(f.m_languages, true))
      and (groups.grp = 'verified' or coalesce(f.m_verified, true))
  )
  from groups;
$$;

-- ---------------------------------------------------------------------------
-- Brief -> creator ranking with transparent reasons.
-- Weights (sum 100): tools 25, skills 20, portfolio relevance 25,
-- campaign experience 10, platform/audience fit 10, availability 10.
-- When a brief leaves a factor unspecified the factor scores half (neutral).
-- ---------------------------------------------------------------------------
create or replace function public.rank_creators_for_campaign(
  p_campaign_id uuid,
  p_limit int default 20,
  p_offset int default 0,
  p_exclude_swiped boolean default false,
  p_only uuid[] default null)
returns table (creator jsonb, score int, breakdown jsonb, reasons text[], total_count bigint)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare
  c public.campaigns%rowtype;
  v_tools int[];
  v_skills int[];
  v_platforms int[];
  v_langs int[];
  v_dims int;
begin
  select * into c from public.campaigns where id = p_campaign_id;   -- RLS applies
  if not found then
    raise exception 'Campaign not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(tool_id), '{}') into v_tools from public.campaign_tools where campaign_id = c.id;
  select coalesce(array_agg(skill_id), '{}') into v_skills from public.campaign_skills where campaign_id = c.id;
  select coalesce(array_agg(platform_id), '{}') into v_platforms from public.campaign_platforms where campaign_id = c.id;
  select coalesce(array_agg(language_id), '{}') into v_langs from public.campaign_languages where campaign_id = c.id;
  v_dims := (c.content_type_id is not null)::int + (c.style_id is not null)::int
          + (c.category_id is not null)::int + (cardinality(c.aspect_ratios) > 0)::int
          + (cardinality(v_tools) > 0)::int;

  return query
  with base as (
    select p.id, p.is_verified, cd.availability, coalesce(s.followers_count, 0) as followers
    from public.profiles p
    join public.creator_details cd on cd.profile_id = p.id
    left join public.profile_stats s on s.profile_id = p.id
    where p.role = 'creator' and not p.is_suspended
      and (p_only is not null or p.id is distinct from auth.uid())   -- explicit lists may include the caller ("your relevance")
      and (p_only is null or p.id = any(p_only))
      and (not p_exclude_swiped or not exists (
            select 1 from public.interactions i
            where i.user_id = auth.uid() and i.target_type = 'profile' and i.target_id = p.id
              and i.action in ('swipe_left', 'swipe_right')))
  ),
  f as (
    select b.*,
      coalesce(mt.names, '{}') as tool_names,
      coalesce(vt.names, '{}') as verified_tool_names,
      coalesce(ms.names, '{}') as skill_names,
      coalesce(mp.names, '{}') as platform_names,
      coalesce(ml.names, '{}') as language_names,
      exists (select 1 from public.creator_categories x where x.creator_id = b.id and x.category_id = c.category_id) as cat_match,
      (exists (select 1 from public.creator_content_types x where x.creator_id = b.id and x.content_type_id = c.content_type_id)
        or exists (select 1 from public.posts x where x.creator_id = b.id and not x.is_removed
                   and x.content_type_id = c.content_type_id)) as ct_match,
      coalesce((select avg(r) from unnest(pr.rels[1:3]) r), 0) as relevance,
      coalesce((select count(*) from unnest(pr.rels) r where r >= 0.5), 0) as match_posts,
      (select count(*) from public.creator_experiences e where e.creator_id = b.id)
        + (select count(*) from public.campaign_creators x where x.creator_id = b.id) as exp_count,
      exists (select 1 from public.verifications v
              where v.creator_id = b.id and v.type = 'past_work' and v.status = 'approved') as verified_past
    from base b
    left join lateral (
      select array_agg(t.name order by t.sort, t.name) as names
      from public.creator_tools ct join public.ai_tools t on t.id = ct.tool_id
      where ct.creator_id = b.id and ct.tool_id = any(v_tools)) mt on true
    left join lateral (
      select array_agg(t.name order by t.name) as names
      from public.verifications v join public.ai_tools t on t.id = v.tool_id
      where v.creator_id = b.id and v.type = 'tool' and v.status = 'approved' and v.tool_id = any(v_tools)) vt on true
    left join lateral (
      select array_agg(k.name order by k.sort, k.name) as names
      from public.creator_skills cs join public.skills k on k.id = cs.skill_id
      where cs.creator_id = b.id and cs.skill_id = any(v_skills)) ms on true
    left join lateral (
      select array_agg(x.name order by x.sort) as names
      from public.creator_platforms cp join public.platforms x on x.id = cp.platform_id
      where cp.creator_id = b.id and cp.platform_id = any(v_platforms)) mp on true
    left join lateral (
      select array_agg(x.name order by x.sort) as names
      from public.creator_languages cl join public.languages x on x.id = cl.language_id
      where cl.creator_id = b.id and cl.language_id = any(v_langs)) ml on true
    left join lateral (
      select array_agg(q.rel order by q.rel desc) as rels
      from (
        select (
            (case when c.content_type_id is not null and po.content_type_id = c.content_type_id then 1 else 0 end)
          + (case when c.style_id is not null and po.style_id = c.style_id then 1 else 0 end)
          + (case when c.category_id is not null and po.category_id = c.category_id then 1 else 0 end)
          + (case when cardinality(c.aspect_ratios) > 0 and po.aspect_ratio = any(c.aspect_ratios) then 1 else 0 end)
          + (case when cardinality(v_tools) > 0 and exists (
                select 1 from public.post_tools pt where pt.post_id = po.id and pt.tool_id = any(v_tools)) then 1 else 0 end)
          )::numeric / greatest(v_dims, 1) as rel
        from public.posts po
        where po.creator_id = b.id and not po.is_removed
      ) q) pr on true
  ),
  s as (
    select f.*,
      case when cardinality(v_tools) = 0 then 12.5
           else 25.0 * cardinality(f.tool_names) / cardinality(v_tools) end as s_tools,
      case when cardinality(v_skills) = 0 then 10.0
           else 20.0 * cardinality(f.skill_names) / cardinality(v_skills) end as s_skills,
      case when v_dims = 0 then 12.5 else 25.0 * f.relevance end as s_portfolio,
      case when f.verified_past then 10 when f.exp_count >= 2 then 8 when f.exp_count = 1 then 5 else 0 end as s_experience,
      ( case when cardinality(v_platforms) = 0 then 2.0
             else 4.0 * cardinality(f.platform_names) / cardinality(v_platforms) end
      + case when cardinality(v_langs) = 0 then 1.5
             else 3.0 * cardinality(f.language_names) / cardinality(v_langs) end
      + case when c.category_id is null then 0.75 when f.cat_match then 1.5 else 0 end
      + case when c.content_type_id is null then 0.75 when f.ct_match then 1.5 else 0 end) as s_fit,
      case f.availability when 'open' then 10 when 'limited' then 5 else 0 end as s_avail
    from f
  ),
  scored as (
    select s.*,
      least(100, round(s.s_tools + s.s_skills + s.s_portfolio + s.s_experience + s.s_fit + s.s_avail))::int as total_score,
      array_remove(array[
        case when cardinality(s.tool_names) > 0 then
          format('Uses %s (%s/%s required tools)', array_to_string(s.tool_names[1:3], ', '),
                 cardinality(s.tool_names), cardinality(v_tools)) end,
        case when cardinality(s.verified_tool_names) > 0 then
          format('Verified on %s', array_to_string(s.verified_tool_names[1:2], ' & ')) end,
        case when cardinality(s.skill_names) > 0 then
          format('Skilled in %s', array_to_string(s.skill_names[1:3], ', ')) end,
        case when s.match_posts > 0 then
          format('%s portfolio %s this brief''s format & style', s.match_posts,
                 case when s.match_posts = 1 then 'piece matches' else 'pieces match' end) end,
        case when s.verified_past then 'Verified past brand collaboration'
             when s.exp_count > 0 then format('%s past brand project%s', s.exp_count,
                 case when s.exp_count = 1 then '' else 's' end) end,
        case when cardinality(s.platform_names) > 0 then
          format('Creates for %s', array_to_string(s.platform_names[1:3], ', ')) end,
        case when cardinality(s.language_names) > 0 then
          format('Works in %s', array_to_string(s.language_names, ', ')) end,
        case s.availability when 'open' then 'Available now' when 'limited' then 'Limited availability' end,
        case when s.is_verified then 'Verified creator' end
      ], null) as why
    from s
  ),
  page as (
    select sc.*, count(*) over () as total
    from scored sc
    order by sc.total_score desc, sc.followers desc, sc.id
    limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0)
  )
  select public.creator_card(page.id),
         page.total_score,
         jsonb_build_object(
           'tools', jsonb_build_object('score', round(page.s_tools, 1), 'max', 25),
           'skills', jsonb_build_object('score', round(page.s_skills, 1), 'max', 20),
           'portfolio', jsonb_build_object('score', round(page.s_portfolio, 1), 'max', 25),
           'experience', jsonb_build_object('score', page.s_experience, 'max', 10),
           'fit', jsonb_build_object('score', round(page.s_fit, 1), 'max', 10),
           'availability', jsonb_build_object('score', page.s_avail, 'max', 10)),
         page.why,
         page.total
  from page
  order by page.total_score desc, page.followers desc, page.id;
end $$;

-- ---------------------------------------------------------------------------
-- Swipe deck: never shows creators the caller already swiped.
-- Brands default to their latest active brief; otherwise affinity-based.
-- ---------------------------------------------------------------------------
create or replace function public.get_swipe_deck(p_campaign_id uuid default null, p_limit int default 15)
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
      from public.rank_creators_for_campaign(v_campaign, p_limit, 0, true) r;
    return;
  end if;

  return query
  with my_tools as (
    select tool_id from public.creator_tools where creator_id = v_uid
    union select pt.tool_id from public.likes l join public.post_tools pt on pt.post_id = l.post_id where l.user_id = v_uid
    union select pt.tool_id from public.saves sv join public.post_tools pt on pt.post_id = sv.post_id where sv.user_id = v_uid
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
      and not exists (select 1 from public.interactions i
                      where i.user_id = v_uid and i.target_type = 'profile' and i.target_id = p.id
                        and i.action in ('swipe_left', 'swipe_right'))
      and not exists (select 1 from public.follows f where f.follower_id = v_uid and f.following_id = p.id)
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

-- ---------------------------------------------------------------------------
-- Home feed: followed creators + personal affinity + freshness + popularity
-- + a deterministic per-user exploration jitter. Each extra post from the same
-- creator is penalised so the feed stays diverse. Ordering is stable for
-- paging (scores are bucketed to the hour).
-- ---------------------------------------------------------------------------
create or replace function public.get_feed(p_limit int default 12, p_offset int default 0)
returns table (post jsonb, reason text, score real)
language sql stable set search_path = public as $$
  with me as (select auth.uid() as uid, date_trunc('hour', now()) as t),
  followed as (select following_id from public.follows where follower_id = (select uid from me)),
  tool_aff as (
    select tool_id, sum(w) as w from (
      select pt.tool_id, 1.0 as w from public.likes l join public.post_tools pt on pt.post_id = l.post_id
        where l.user_id = (select uid from me)
      union all
      select pt.tool_id, 2.0 from public.saves s join public.post_tools pt on pt.post_id = s.post_id
        where s.user_id = (select uid from me)
      union all
      select ct.tool_id, 1.0 from public.interactions i join public.creator_tools ct on ct.creator_id = i.target_id
        where i.user_id = (select uid from me) and i.target_type = 'profile' and i.action in ('swipe_right', 'follow')
      union all
      select tool_id, 1.5 from public.creator_tools where creator_id = (select uid from me)
    ) x group by tool_id
  ),
  cat_aff as (
    select category_id, sum(w) as w from (
      select po.category_id, 1.0 as w from public.likes l join public.posts po on po.id = l.post_id
        where l.user_id = (select uid from me) and po.category_id is not null
      union all
      select po.category_id, 2.0 from public.saves s join public.posts po on po.id = s.post_id
        where s.user_id = (select uid from me) and po.category_id is not null
      union all
      select cc.category_id, 1.0 from public.interactions i join public.creator_categories cc on cc.creator_id = i.target_id
        where i.user_id = (select uid from me) and i.target_type = 'profile' and i.action in ('swipe_right', 'follow')
      union all
      select category_id, 1.5 from public.creator_categories where creator_id = (select uid from me)
    ) x group by category_id
  ),
  norm as (
    select greatest(coalesce((select max(w) from tool_aff), 1), 1) as tmax,
           greatest(coalesce((select max(w) from cat_aff), 1), 1) as cmax
  ),
  scored as (
    select p.id, p.creator_id,
      p.creator_id in (select following_id from followed) as is_followed,
      coalesce((select sum(ta.w) from public.post_tools pt join tool_aff ta on ta.tool_id = pt.tool_id
                where pt.post_id = p.id), 0) / (select tmax from norm) as t_aff,
      coalesce((select ca.w from cat_aff ca where ca.category_id = p.category_id), 0) / (select cmax from norm) as c_aff,
      greatest(extract(epoch from ((select t from me) - p.created_at)) / 3600.0, 0) as age_h,
      ln(1 + p.likes_count + 2 * p.saves_count + p.comments_count) as pop,
      (abs(hashtext(p.id::text || coalesce((select uid from me)::text, 'anon'))) % 1000) / 1000.0 as jitter
    from public.posts p
    where not p.is_removed and p.creator_id is distinct from (select uid from me)
  ),
  ranked as (
    select scored.*,
      ( case when is_followed then 3.0 else 0 end
      + least(t_aff, 1.5) * 2.0 + least(c_aff, 1.5) * 1.5
      + 2.0 * exp(-age_h / 168.0) + pop * 0.5 + jitter * 0.8) as base_score
    from scored
  ),
  diversified as (
    select ranked.*,
      base_score - (row_number() over (partition by creator_id order by base_score desc, id) - 1) * 0.9 as fscore,
      case when is_followed then 'following'
           when t_aff + c_aff > 0.25 then 'for_you'
           when age_h < 168 then 'fresh'
           else 'explore' end as why
    from ranked
  ),
  page as (
    select id, why, fscore from diversified
    order by fscore desc, id
    limit greatest(least(p_limit, 40), 1) offset greatest(p_offset, 0)
  )
  select public.post_card(page.id), page.why, page.fscore::real
  from page
  order by page.fscore desc, page.id;
$$;

-- ---------------------------------------------------------------------------
-- Opportunities for creators (active briefs ranked against the creator)
-- ---------------------------------------------------------------------------
create or replace function public.get_opportunities(
  p_tab text default 'for_you', p_limit int default 12, p_offset int default 0)
returns table (campaign jsonb, score int, reasons text[], total_count bigint)
language sql stable set search_path = public as $$
  with me as (select auth.uid() as uid),
  my_tools as (select tool_id from public.creator_tools where creator_id = (select uid from me)),
  my_skills as (select skill_id from public.creator_skills where creator_id = (select uid from me)),
  my_ct as (
    select content_type_id from public.creator_content_types where creator_id = (select uid from me)
    union select content_type_id from public.posts
          where creator_id = (select uid from me) and content_type_id is not null and not is_removed),
  my_styles as (
    select style_id from public.creator_styles where creator_id = (select uid from me)
    union select style_id from public.posts
          where creator_id = (select uid from me) and style_id is not null and not is_removed),
  my_cats as (
    select category_id from public.creator_categories where creator_id = (select uid from me)
    union select category_id from public.posts
          where creator_id = (select uid from me) and category_id is not null and not is_removed),
  my_langs as (select language_id from public.creator_languages where creator_id = (select uid from me)),
  my_platforms as (select platform_id from public.creator_platforms where creator_id = (select uid from me)),
  cand as (
    select c.id, c.deadline, c.created_at, c.content_type_id, c.style_id, c.category_id,
      array(select t.name from public.campaign_tools x join public.ai_tools t on t.id = x.tool_id
            where x.campaign_id = c.id and x.tool_id in (select tool_id from my_tools) order by t.sort, t.name) as tool_hits,
      (select count(*) from public.campaign_tools x where x.campaign_id = c.id) as tool_req,
      array(select k.name from public.campaign_skills x join public.skills k on k.id = x.skill_id
            where x.campaign_id = c.id and x.skill_id in (select skill_id from my_skills) order by k.sort, k.name) as skill_hits,
      (select count(*) from public.campaign_skills x where x.campaign_id = c.id) as skill_req,
      array(select pl.name from public.campaign_platforms x join public.platforms pl on pl.id = x.platform_id
            where x.campaign_id = c.id and x.platform_id in (select platform_id from my_platforms) order by pl.sort) as platform_hits,
      (select count(*) from public.campaign_platforms x where x.campaign_id = c.id) as platform_req,
      array(select l.name from public.campaign_languages x join public.languages l on l.id = x.language_id
            where x.campaign_id = c.id and x.language_id in (select language_id from my_langs) order by l.sort) as lang_hits,
      (select count(*) from public.campaign_languages x where x.campaign_id = c.id) as lang_req,
      c.content_type_id in (select content_type_id from my_ct) as ct_match,
      c.style_id in (select style_id from my_styles) as style_match,
      c.category_id in (select category_id from my_cats) as cat_match,
      (select name from public.content_types where id = c.content_type_id) as ct_name,
      (select name from public.styles where id = c.style_id) as style_name
    from public.campaigns c
    where c.status = 'active'
      and (c.deadline is null or c.deadline >= current_date or p_tab in ('saved', 'applied'))
      and c.brand_id is distinct from (select uid from me)
      and case p_tab
        when 'saved' then exists (select 1 from public.saved_opportunities so
                                  where so.campaign_id = c.id and so.creator_id = (select uid from me))
        when 'applied' then exists (select 1 from public.campaign_applications a
                                    where a.campaign_id = c.id and a.creator_id = (select uid from me))
        else not exists (select 1 from public.campaign_applications a
                         where a.campaign_id = c.id and a.creator_id = (select uid from me))
         and not exists (select 1 from public.interactions i
                         where i.user_id = (select uid from me) and i.target_type = 'campaign'
                           and i.target_id = c.id and i.action = 'ignore')
      end
  ),
  scored as (
    select cand.*,
      least(100, round(
          (case when tool_req = 0 then 15 else 30.0 * cardinality(tool_hits) / tool_req end)
        + (case when skill_req = 0 then 10 else 20.0 * cardinality(skill_hits) / skill_req end)
        + (case when content_type_id is null then 10 when ct_match then 20 else 0 end)
        + (case when style_id is null then 3.75 when style_match then 7.5 else 0 end)
        + (case when category_id is null then 3.75 when cat_match then 7.5 else 0 end)
        + (case when platform_req = 0 then 5 else 10.0 * cardinality(platform_hits) / platform_req end)
        + (case when lang_req = 0 then 2.5 else 5.0 * cardinality(lang_hits) / lang_req end)
      ))::int as sc,
      array_remove(array[
        case when cardinality(tool_hits) > 0 then
          format('You use %s (%s/%s tools)', array_to_string(tool_hits[1:3], ', '), cardinality(tool_hits), tool_req) end,
        case when ct_match then format('You make %s', ct_name) end,
        case when style_match then format('Matches your %s style', style_name) end,
        case when cardinality(skill_hits) > 0 then format('Needs your %s skills', array_to_string(skill_hits[1:2], ' & ')) end,
        case when cardinality(platform_hits) > 0 then format('For %s', array_to_string(platform_hits[1:3], ', ')) end,
        case when cardinality(lang_hits) > 0 then format('In %s', array_to_string(lang_hits, ', ')) end,
        case when deadline is not null and deadline <= current_date + 7 then 'Closing soon' end
      ], null) as why
    from cand
  ),
  page as (
    select scored.id, scored.sc, scored.why, scored.deadline, count(*) over () as total
    from scored
    order by scored.sc desc, scored.deadline nulls last, scored.id
    limit greatest(least(p_limit, 40), 1) offset greatest(p_offset, 0)
  )
  select public.campaign_card(page.id), page.sc, page.why, page.total
  from page
  order by page.sc desc, page.deadline nulls last, page.id;
$$;

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'You cannot start a conversation with yourself';
  end if;
  if not public.is_active_user() then
    raise exception 'Your account is suspended';
  end if;
  if not exists (select 1 from public.profiles where id = p_other and not is_suspended) then
    raise exception 'User not found';
  end if;

  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);
  insert into public.conversations (dm_key) values (v_key)
    on conflict (dm_key) do nothing
    returning id into v_id;

  if v_id is null then
    select id into v_id from public.conversations where dm_key = v_key;
  else
    insert into public.interactions (user_id, target_type, target_id, action, weight)
    values (v_me, 'profile', p_other, 'contact', 3);
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_id, v_me), (v_id, p_other)
  on conflict do nothing;

  return v_id;
end $$;

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conversation_participants set last_read_at = now()
    where conversation_id = p_conversation and user_id = auth.uid();
  update public.notifications set read_at = now()
    where user_id = auth.uid() and type = 'message' and entity_id = p_conversation and read_at is null;
end $$;

create or replace function public.get_inbox(
  p_other_role text default null, p_query text default null, p_limit int default 30, p_offset int default 0)
returns table (
  conversation_id uuid, last_message_at timestamptz, last_message_preview text, last_sender_id uuid,
  unread_count int, other jsonb, total_count bigint)
language sql stable set search_path = public as $$
  select c.id, coalesce(c.last_message_at, c.created_at), c.last_message_preview, c.last_sender_id,
    (select count(*) from public.messages m
     where m.conversation_id = c.id and m.created_at > me.last_read_at and m.sender_id <> me.user_id)::int,
    jsonb_build_object('id', o.id, 'username', o.username, 'display_name', o.display_name,
      'avatar_url', o.avatar_url, 'role', o.role, 'is_verified', o.is_verified, 'headline', o.headline),
    count(*) over ()
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  join public.conversation_participants op on op.conversation_id = c.id and op.user_id <> me.user_id
  join public.profiles o on o.id = op.user_id
  where me.user_id = auth.uid()
    and (p_other_role is null or o.role = p_other_role
         or (p_other_role = 'brand' and o.role = 'admin'))
    and (nullif(trim(p_query), '') is null
         or o.display_name ilike '%' || trim(p_query) || '%'
         or o.username::text ilike '%' || trim(p_query) || '%'
         or c.last_message_preview ilike '%' || trim(p_query) || '%')
  order by coalesce(c.last_message_at, c.created_at) desc, c.id
  limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0);
$$;

create or replace function public.get_unread_counts()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'notifications', (select count(*) from public.notifications
                      where user_id = auth.uid() and read_at is null),
    'messages', (select count(*) from public.messages m
                 join public.conversation_participants me
                   on me.conversation_id = m.conversation_id and me.user_id = auth.uid()
                 where m.created_at > me.last_read_at and m.sender_id <> auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Dashboards
-- ---------------------------------------------------------------------------
create or replace function public.get_brand_dashboard()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'campaigns', (select count(*) from public.campaigns where brand_id = auth.uid()),
    'active', (select count(*) from public.campaigns where brand_id = auth.uid() and status = 'active'),
    'applications', (select count(*) from public.campaign_applications a
                     join public.campaigns c on c.id = a.campaign_id
                     where c.brand_id = auth.uid() and a.status <> 'withdrawn'),
    'shortlisted', (select count(*) from public.campaign_shortlists s
                    join public.campaigns c on c.id = s.campaign_id where c.brand_id = auth.uid()),
    'selected', (select count(*) from public.campaign_creators s
                 join public.campaigns c on c.id = s.campaign_id where c.brand_id = auth.uid()),
    'liked_creators', (select count(distinct target_id) from public.interactions
                       where user_id = auth.uid() and target_type = 'profile' and action = 'swipe_right'));
$$;

create or replace function public.get_creator_dashboard()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'applications', (select count(*) from public.campaign_applications
                     where creator_id = auth.uid() and status <> 'withdrawn'),
    'shortlisted', (select count(*) from public.campaign_shortlists where creator_id = auth.uid()),
    'selected', (select count(*) from public.campaign_creators where creator_id = auth.uid()),
    'saved_opportunities', (select count(*) from public.saved_opportunities where creator_id = auth.uid()),
    'profile_views', (select count(*) from public.interactions
                      where target_type = 'profile' and target_id = auth.uid() and action = 'view'),
    'brand_interest', (select count(distinct i.user_id) from public.interactions i
                       join public.profiles p on p.id = i.user_id and p.role = 'brand'
                       where i.target_type = 'profile' and i.target_id = auth.uid()
                         and i.action in ('swipe_right', 'contact', 'shortlist')));
$$;

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'creators', (select count(*) from public.profiles where role = 'creator'),
    'brands', (select count(*) from public.profiles where role = 'brand'),
    'admins', (select count(*) from public.profiles where role = 'admin'),
    'suspended', (select count(*) from public.profiles where is_suspended),
    'verified_creators', (select count(*) from public.profiles where role = 'creator' and is_verified),
    'posts', (select count(*) from public.posts where not is_removed),
    'removed_posts', (select count(*) from public.posts where is_removed),
    'campaigns', jsonb_build_object(
      'draft', (select count(*) from public.campaigns where status = 'draft'),
      'active', (select count(*) from public.campaigns where status = 'active'),
      'completed', (select count(*) from public.campaigns where status = 'completed')),
    'applications', (select count(*) from public.campaign_applications),
    'messages', (select count(*) from public.messages),
    'likes', (select count(*) from public.likes),
    'follows', (select count(*) from public.follows),
    'pending_verifications', (select count(*) from public.verifications where status = 'pending'),
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'signups_14d', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'count',
               (select count(*) from public.profiles p where p.created_at::date = d::date)) order by d)
      from generate_series(current_date - 13, current_date, interval '1 day') d), '[]'::jsonb),
    'top_tools', coalesce((
      select jsonb_agg(x order by (x->>'count')::int desc)
      from (select jsonb_build_object('name', t.name, 'count', count(*)) as x
            from public.creator_tools ct join public.ai_tools t on t.id = ct.tool_id
            group by t.name order by count(*) desc limit 8) q), '[]'::jsonb)
  );
end $$;
