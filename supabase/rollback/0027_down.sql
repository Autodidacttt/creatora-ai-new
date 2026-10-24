-- Rollback of 0027_drop_tool_workflow_verification.sql, captured read-only from production at 0026_identity_company_verification.sql
-- (2026-10-24T09:29:35.975Z). Re-adds verifications.tool_id / post_id (at the end of the column list), restores the
-- tool / workflow rows from private.verifications_retired_0027 and the functions / constraints as they were at 0026.
-- Usage: psql "$SUPABASE_DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/rollback/0027_down.sql
set local check_function_bodies = off;
set local lock_timeout = '5s';

alter table public.verifications add column tool_id integer, add column post_id uuid;
alter table public.verifications add constraint verifications_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES ai_tools(id) ON DELETE CASCADE;
alter table public.verifications add constraint verifications_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
alter table public.verifications add constraint verifications_check CHECK (((type <> 'tool'::text) OR (tool_id IS NOT NULL)));
alter table public.verifications add constraint verifications_check1 CHECK (((type <> 'workflow'::text) OR (post_id IS NOT NULL)));

-- Restore the rows as they were (no triggers: no new notifications, no review / ownership re-checks)
alter table public.verifications drop constraint verifications_type_check;
alter table public.verifications disable trigger user;
insert into public.verifications (id, creator_id, type, tool_id, post_id, experience_id, title, evidence_url, evidence_notes,
    status, reviewed_by, reviewed_at, review_notes, created_at)
  select id, creator_id, type, tool_id, post_id, experience_id, title, evidence_url, evidence_notes,
    status, reviewed_by, reviewed_at, review_notes, created_at
  from private.verifications_retired_0027;
alter table public.verifications enable trigger user;
alter table public.verifications add constraint verifications_type_check CHECK ((type = ANY (ARRAY['past_work'::text, 'identity'::text]))) NOT VALID;

CREATE OR REPLACE FUNCTION public.tg_verifications_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.type = 'tool' and not exists (
      select 1 from public.creator_tools where creator_id = new.creator_id and tool_id = new.tool_id) then
    raise exception 'Tool verification must reference a tool in the creator''s stack';
  end if;
  if new.type = 'workflow' and not exists (
      select 1 from public.posts where id = new.post_id and creator_id = new.creator_id) then
    raise exception 'Workflow verification must reference one of the creator''s own posts';
  end if;
  if new.type = 'past_work' and not exists (
      select 1 from public.creator_experiences where id = new.experience_id and creator_id = new.creator_id) then
    raise exception 'Past work verification must reference the creator''s own experience entry';
  end if;
  return new;
end $function$;

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
               'verified', false)
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
      from public.verifications v where v.creator_id = p.id and v.type = 'past_work'), '[]'::jsonb),
    'badges', public.trust_badges(p.id),
    'is_me', p.id = auth.uid(),
    'is_following', exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.id),
    'follows_you', exists (select 1 from public.follows f where f.follower_id = p.id and f.following_id = auth.uid())
  )
  from public.profiles p
  left join public.profile_stats s on s.profile_id = p.id
  where p.username = p_username::extensions.citext;
$function$;

drop table private.verifications_retired_0027;
delete from private.schema_migrations where name = '0027_drop_tool_workflow_verification.sql';
