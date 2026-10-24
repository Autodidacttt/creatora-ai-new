-- Rollback of 0026_identity_company_verification.sql, captured read-only from production at 0025_clean_files_after_release.sql
-- (2026-10-24T08:15:50.847Z). DESTRUCTIVE for data created after 0026: drops the verification tables (phones, ID
-- verifications, companies, invitations), the badge / brand-type columns and report priorities. Old tool / workflow
-- verification rows were never deleted by 0026, so they come back as they were.
-- Usage (after promoting the previous Vercel deployment): psql "$SUPABASE_DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/rollback/0026_down.sql
set local check_function_bodies = off;
set local lock_timeout = '5s';

-- 1. Functions as they were (before anything they used is dropped)
CREATE OR REPLACE FUNCTION public.admin_list_verifications(p_status text DEFAULT 'pending'::text)
 RETURNS TABLE(id uuid, type text, title text, status text, evidence_url text, evidence_notes text, created_at timestamp with time zone, reviewed_at timestamp with time zone, creator jsonb, subject text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.admin_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.ai_match_evidence(p_search uuid, p_creator uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'idea', s.idea,
    'requirements', s.requirements,
    'score', r.score, 'breakdown', r.breakdown,
    'creator', jsonb_build_object('name', p.display_name, 'headline', p.headline, 'bio', left(p.bio, 600), 'location', p.location,
      'experience_level', d.experience_level, 'years_experience', d.years_experience, 'availability', d.availability,
      'verified', p.is_verified),
    'tools', coalesce((select jsonb_agg(t.name order by t.name) from public.creator_tools j join public.ai_tools t on t.id = j.tool_id where j.creator_id = p.id), '[]'),
    'skills', coalesce((select jsonb_agg(t.name order by t.name) from public.creator_skills j join public.skills t on t.id = j.skill_id where j.creator_id = p.id), '[]'),
    'specializations', coalesce((select jsonb_agg(t.name order by t.name) from public.creator_categories j join public.categories t on t.id = j.category_id where j.creator_id = p.id), '[]'),
    'styles', coalesce((select jsonb_agg(t.name order by t.name) from public.creator_styles j join public.styles t on t.id = j.style_id where j.creator_id = p.id), '[]'),
    'posts', coalesce((select jsonb_agg(q.j) from (
        select jsonb_build_object('title', po.title, 'description', left(po.description, 240), 'content_type', ct.name, 'style', st.name,
                 'tools', (select jsonb_agg(t.name) from public.post_tools pt join public.ai_tools t on t.id = pt.tool_id where pt.post_id = po.id)) as j
        from public.posts po
        left join public.content_types ct on ct.id = po.content_type_id
        left join public.styles st on st.id = po.style_id
        where po.creator_id = p.id and not po.is_removed
        order by (coalesce((po.content_type_id::text = s.requirements->>'content_type_id')::int, 0)
                  + coalesce((po.style_id::text = s.requirements->>'style_id')::int, 0)
                  + (select count(*) from public.post_tools pt where pt.post_id = po.id
                     and pt.tool_id::text in (select jsonb_array_elements_text(coalesce(s.requirements->'tool_ids', '[]'))))) desc nulls last,
                 po.likes_count desc, po.created_at desc
        limit 6) q), '[]'),
    'completed_projects', (select count(*) from public.campaign_creators x where x.creator_id = p.id and x.status = 'completed'),
    'verified_items', (select count(*) from public.verifications v where v.creator_id = p.id and v.status = 'approved'))
  from public.ai_match_searches s
  join public.ai_match_results r on r.search_id = s.id and r.creator_id = p_creator
  join public.profiles p on p.id = p_creator
  left join public.creator_details d on d.profile_id = p.id
  where s.id = p_search and s.brand_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.campaign_card(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select to_jsonb(c) - 'search' - (case when c.brand_id = auth.uid() then '{}'::text[]
                                   else array['source_idea', 'source_url', 'source_summary', 'studio_step'] end) || jsonb_build_object(
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
                           where s.campaign_id = c.id and s.creator_id = auth.uid() and s.hired_at is not null),
    'my_project', (select jsonb_build_object('id', s.id, 'status', s.status) from public.campaign_creators s
                   where s.campaign_id = c.id and s.creator_id = auth.uid()),
    'sprint_closed', c.is_sprint and c.sprint_deadline <= now(),
    'saved', exists (select 1 from public.saved_opportunities so
                     where so.campaign_id = c.id and so.creator_id = auth.uid())
  )
  from public.campaigns c
  join public.profiles b on b.id = c.brand_id
  left join public.brand_details bd on bd.profile_id = b.id
  where c.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.creator_card(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.do_hire(p_actor uuid, p_campaign uuid, p_creator uuid, p_amount integer, p_currency text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := p_actor;
  v_c public.campaigns;
  v_x public.campaign_creators;
  v_cur text;
  v_e public.escrow_payments;
  v_label text;
begin
  select * into v_c from public.campaigns where id = p_campaign;
  if not found or v_c.brand_id <> v_me then
    raise exception 'Only the brand that owns this campaign can hire for it' using errcode = '42501';
  end if;
  if v_c.status = 'completed' then raise exception 'This campaign is already completed'; end if;
  if not exists (select 1 from public.profiles where id = p_creator and role = 'creator' and not is_suspended) then
    raise exception 'Creator not found';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000000 then
    raise exception 'Enter an agreed amount greater than zero' using errcode = '23514';
  end if;
  v_cur := upper(coalesce(nullif(trim(p_currency), ''), v_c.currency));
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'Invalid currency'; end if;
  v_label := private.money(p_amount, v_cur);

  select * into v_x from public.campaign_creators where campaign_id = p_campaign and creator_id = p_creator for update;
  if exists (select 1 from public.escrow_payments where campaign_creator_id = v_x.id and status <> 'unfunded') then
    raise exception 'Escrow is already funded — the agreed amount is locked' using errcode = '23514';
  end if;

  perform private.set_context(v_me, null, jsonb_build_object('amount', p_amount, 'currency', v_cur, 'amount_label', v_label));
  if v_x.id is null then
    insert into public.campaign_creators (campaign_id, creator_id, status, hired_at, agreed_amount, currency)
    values (p_campaign, p_creator, 'awaiting_funding', now(), p_amount, v_cur) returning * into v_x;
  else
    if v_x.status in ('approved', 'completed', 'rejected', 'cancelled') then
      raise exception 'This project is already %', replace(v_x.status, '_', ' ');
    end if;
    update public.campaign_creators set agreed_amount = p_amount, currency = v_cur, hired_at = coalesce(hired_at, now())
      where id = v_x.id;
    -- New hires wait for the brand to fund the escrow before work starts (0023)
    if v_x.status in ('applied', 'shortlisted', 'hired') then
      update public.campaign_creators set status = 'awaiting_funding' where id = v_x.id;
    elsif v_x.hired_at is null then
      -- A sprint entrant who already submitted: hiring doesn't change where their work is in review
      insert into public.project_events (project_id, actor_id, kind, event, data)
      values (v_x.id, v_me, 'status', 'hired', private.ctx_data());
    end if;
  end if;

  select * into v_e from public.escrow_payments where campaign_creator_id = v_x.id;
  if v_e.id is null then
    insert into public.escrow_payments (campaign_creator_id, amount, currency, platform_fee)
    values (v_x.id, p_amount, v_cur, ceil(p_amount * 0.08)::int) returning * into v_e;
    insert into public.payment_events (escrow_id, actor_id, event, from_status, to_status, amount, currency, note)
    values (v_e.id, v_me, 'created', null, 'unfunded', p_amount, v_cur, 'Escrow opened on hire (test mode)');
  elsif v_e.amount <> p_amount or v_e.currency <> v_cur then
    update public.escrow_payments set amount = p_amount, currency = v_cur, platform_fee = ceil(p_amount * 0.08)::int where id = v_e.id;
    insert into public.payment_events (escrow_id, actor_id, event, from_status, to_status, amount, currency)
    values (v_e.id, v_me, 'amount_set', 'unfunded', 'unfunded', p_amount, v_cur);
  end if;
  return v_x.id;
end $function$;

CREATE OR REPLACE FUNCTION public.get_conversation(p_conversation uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', c.id, 'type', c.type,
    'campaign', (select jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status, 'brand_id', x.brand_id)
                 from public.campaigns x where x.id = c.campaign_id),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
                           'avatar_url', p.avatar_url, 'role', p.role, 'is_verified', p.is_verified) order by p.role, p.display_name)
                         from public.conversation_participants cp join public.profiles p on p.id = cp.user_id
                         where cp.conversation_id = c.id), '[]'::jsonb))
  from public.conversations c
  where c.id = p_conversation and public.is_participant(c.id);
$function$;

CREATE OR REPLACE FUNCTION public.get_inbox(p_other_role text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(conversation_id uuid, last_message_at timestamp with time zone, last_message_preview text, last_sender_id uuid, unread_count integer, other jsonb, total_count bigint, conversation_type text, campaign jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (
    select c.*, me.last_read_at, me.user_id as me_id from public.conversation_participants me
    join public.conversations c on c.id = me.conversation_id
    where me.user_id = auth.uid()
  ), rows as (
    select m.id, coalesce(m.last_message_at, m.created_at) as at, m.last_message_preview, m.last_sender_id, m.type,
      (select count(*) from public.messages x where x.conversation_id = m.id and x.created_at > m.last_read_at and x.sender_id <> m.me_id)::int as unread,
      case when m.type = 'group' then
        jsonb_build_object('id', cp.id, 'username', null, 'display_name', cp.title || ' · group',
          'avatar_url', b.avatar_url, 'role', 'group', 'is_verified', false,
          'headline', (select count(*) from public.conversation_participants g where g.conversation_id = m.id) || ' members')
      else
        (select jsonb_build_object('id', o.id, 'username', o.username, 'display_name', o.display_name,
                  'avatar_url', o.avatar_url, 'role', o.role, 'is_verified', o.is_verified, 'headline', o.headline)
         from public.conversation_participants op join public.profiles o on o.id = op.user_id
         where op.conversation_id = m.id and op.user_id <> m.me_id limit 1)
      end as other,
      case when cp.id is not null then jsonb_build_object('id', cp.id, 'title', cp.title, 'status', cp.status) end as campaign
    from mine m
    left join public.campaigns cp on cp.id = m.campaign_id
    left join public.profiles b on b.id = cp.brand_id
  )
  select r.id, r.at, r.last_message_preview, r.last_sender_id, r.unread, r.other, count(*) over (), r.type, r.campaign
  from rows r
  where r.other is not null
    and (p_other_role is null or r.other->>'role' = p_other_role
         or (p_other_role = 'brand' and r.other->>'role' in ('admin', 'group')))
    and (nullif(trim(p_query), '') is null
         or r.other->>'display_name' ilike '%' || trim(p_query) || '%'
         or coalesce(r.other->>'username', '') ilike '%' || trim(p_query) || '%'
         or r.campaign->>'title' ilike '%' || trim(p_query) || '%'
         or r.last_message_preview ilike '%' || trim(p_query) || '%')
  order by r.at desc, r.id
  limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0);
$function$;

CREATE OR REPLACE FUNCTION public.get_profile(p_username text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'creator');
  v_name text := nullif(trim(new.raw_user_meta_data->>'display_name'), '');
  v_base text;
  v_username text;
  v_i int := 0;
begin
  if v_role not in ('creator', 'brand') then
    v_role := 'creator';
  end if;

  v_base := lower(regexp_replace(
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1), 'user'),
    '[^a-zA-Z0-9_.]', '', 'g'));
  if char_length(v_base) < 3 then
    v_base := v_base || 'user';
  end if;
  v_base := left(v_base, 24);
  v_username := v_base;
  while exists (select 1 from public.profiles where username = v_username) loop
    v_i := v_i + 1;
    v_username := v_base || v_i::text;
  end loop;

  insert into public.profiles (id, role, username, display_name)
  values (new.id, v_role, v_username, coalesce(left(v_name, 80), v_username));

  insert into public.profile_stats (profile_id) values (new.id);

  if v_role = 'creator' then
    insert into public.creator_details (profile_id) values (new.id);
  else
    insert into public.brand_details (profile_id, company_name)
    values (new.id, coalesce(left(v_name, 120), v_username));
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.mini_profile_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
           'avatar_url', p.avatar_url, 'is_verified', p.is_verified, 'role', p.role,
           'company_name', bd.company_name)
  from public.profiles p left join public.brand_details bd on bd.profile_id = p.id where p.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.post_card(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.rank_creators_for_campaign(p_campaign_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_exclude_swiped boolean DEFAULT false, p_only uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(creator jsonb, score integer, breakdown jsonb, reasons text[], total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
        + (select count(*) from public.campaign_creators x where x.creator_id = b.id and x.hired_at is not null) as exp_count,
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
end $function$;

drop function if exists public.search_creators(text, integer[], integer[], integer[], integer[], integer[], text[], text[], integer[], boolean, text, text, uuid[], integer, integer, boolean, boolean);
CREATE OR REPLACE FUNCTION public.search_creators(p_query text DEFAULT NULL::text, p_skills integer[] DEFAULT NULL::integer[], p_categories integer[] DEFAULT NULL::integer[], p_tools integer[] DEFAULT NULL::integer[], p_content_types integer[] DEFAULT NULL::integer[], p_styles integer[] DEFAULT NULL::integer[], p_experience text[] DEFAULT NULL::text[], p_availability text[] DEFAULT NULL::text[], p_languages integer[] DEFAULT NULL::integer[], p_verified_only boolean DEFAULT false, p_sort text DEFAULT 'best'::text, p_match text DEFAULT 'all'::text, p_exclude uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
 RETURNS TABLE(creator jsonb, score real, matched_groups integer, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;
revoke all on function search_creators(text,integer[],integer[],integer[],integer[],integer[],text[],text[],integer[],boolean,text,text,uuid[],integer,integer) from public, anon, authenticated, service_role;
grant execute on function search_creators(text,integer[],integer[],integer[],integer[],integer[],text[],text[],integer[],boolean,text,text,uuid[],integer,integer) to public;

drop function if exists public.get_swipe_deck(uuid, integer, boolean, boolean, boolean);
CREATE OR REPLACE FUNCTION public.get_swipe_deck(p_campaign_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 15, p_include_seen boolean DEFAULT false)
 RETURNS TABLE(creator jsonb, score integer, reasons text[], campaign_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
end $function$;
revoke all on function get_swipe_deck(uuid,integer,boolean) from public, anon, authenticated, service_role;
grant execute on function get_swipe_deck(uuid,integer,boolean) to public;
grant execute on function get_swipe_deck(uuid,integer,boolean) to postgres;
grant execute on function get_swipe_deck(uuid,integer,boolean) to anon;
grant execute on function get_swipe_deck(uuid,integer,boolean) to authenticated;
grant execute on function get_swipe_deck(uuid,integer,boolean) to service_role;

drop function if exists public.admin_list_reports(text);
CREATE OR REPLACE FUNCTION public.admin_list_reports(p_status text DEFAULT 'open'::text)
 RETURNS TABLE(id uuid, target_type text, target_id uuid, reason text, details text, status text, created_at timestamp with time zone, reporter jsonb, target_label text, target_removed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
revoke all on function admin_list_reports(text) from public, anon, authenticated, service_role;
grant execute on function admin_list_reports(text) to public;
grant execute on function admin_list_reports(text) to postgres;

-- 2. New triggers, functions and tables
drop trigger if exists campaigns_publish_gate on public.campaigns;
drop function if exists private.setting(text, jsonb);
drop function if exists public.has_admin_permission(text);
drop function if exists public.trust_badges(uuid);
drop function if exists public.brand_can_operate(uuid);
drop function if exists public.tg_campaign_publish_gate();
drop function if exists public.set_brand_type(text);
drop function if exists public.verification_record_phone(uuid, text, text, text, text);
drop function if exists public.verification_submit_identity(uuid, text, text, text, text, text, date, text, boolean);
drop function if exists public.verification_set_mock_check(uuid, jsonb);
drop function if exists public.verification_submit_company(uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, boolean);
drop function if exists public.get_my_verification();
drop function if exists private.notify_verifiers(text, uuid, jsonb);
drop function if exists private.identity_permission(text);
drop function if exists public.admin_list_identity_verifications(text, text, text, int, int);
drop function if exists public.admin_get_identity_verification(uuid);
drop function if exists public.admin_decide_identity(uuid, text, text);
drop function if exists public.admin_list_company_verifications(text, text, int, int);
drop function if exists public.admin_get_company_verification(uuid);
drop function if exists private.decide_company(uuid, text, text, uuid, text);
drop function if exists public.admin_decide_company(uuid, text, text);
drop function if exists public.admin_add_contact(uuid, text, text, text, text, text);
drop function if exists public.admin_create_invitation(uuid, uuid, text, text, text, text, text, int);
drop function if exists public.company_invitation_lookup(text);
drop function if exists public.company_invitation_respond(text, text, text);
drop function if exists public.identity_images_due(int, int);
drop function if exists public.identity_image_purged(uuid);
drop table if exists public.company_invitations cascade;
drop table if exists public.company_contact_suggestions cascade;
drop table if exists public.demo_company_directory cascade;
drop table if exists public.company_verifications cascade;
drop table if exists public.mock_identity_records cascade;
drop table if exists public.identity_verifications cascade;
drop table if exists public.verified_phones cascade;
drop table if exists public.phone_otp_challenges cascade;
drop table if exists public.admin_permissions cascade;
drop table if exists public.app_settings cascade;

-- 3. Columns and privileges
alter table public.profiles drop column if exists phone_verified_at, drop column if exists identity_verified_at;
alter table public.brand_details drop column if exists brand_type, drop column if exists verification_required, drop column if exists company_verified_at;
grant update on public.brand_details to authenticated;
update public.reports set reason = 'other' where reason = 'impersonation';
alter table public.reports drop column if exists priority;

-- 4. Constraints as they were
alter table ai_job_logs drop constraint ai_job_logs_job_check;
alter table ai_job_logs add constraint ai_job_logs_job_check CHECK ((job = ANY (ARRAY['submission_review'::text, 'watermark'::text, 'certificate'::text, 'ai_match'::text, 'ai_match_reason'::text, 'creator_embeddings'::text]))) not valid;
alter table reports drop constraint reports_reason_check;
alter table reports add constraint reports_reason_check CHECK ((reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'ip_infringement'::text, 'misleading'::text, 'inappropriate'::text, 'other'::text])));
alter table verifications drop constraint verifications_type_check;
alter table verifications add constraint verifications_type_check CHECK ((type = ANY (ARRAY['tool'::text, 'workflow'::text, 'past_work'::text, 'identity'::text])));

-- 5. The private identity-documents bucket is kept (empty it first if needed); let the runner re-apply 0026 later
do $do$ begin
  if to_regclass('private.schema_migrations') is not null then
    delete from private.schema_migrations where name = '0026_identity_company_verification.sql';
  end if;
end $do$;
notify pgrst, 'reload schema';
