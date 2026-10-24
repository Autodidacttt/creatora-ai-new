-- Rollback of 0025_clean_files_after_release.sql, captured read-only from the database before 0025 was applied
-- (last migration at capture time: 0024_accept_hire_funding_cleanup.sql; 2026-10-24T03:40:28.708Z). 0025 changes no row data, only these objects.
-- Usage: psql "$SUPABASE_DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/rollback/0025_down.sql
set local lock_timeout = '5s';

-- Functions as they were
CREATE OR REPLACE FUNCTION public.can_access_originals(p_submission uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.submissions s
    join public.campaigns c on c.id = s.campaign_id
    left join public.escrow_payments e on e.campaign_creator_id = s.project_id
    where s.id = p_submission
      and (s.creator_id = auth.uid()
           or public.is_admin()
           or (c.brand_id = auth.uid() and s.status = 'approved' and e.status in ('funded', 'released'))));
$function$;

CREATE OR REPLACE FUNCTION public.submission_json(p_submission uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select to_jsonb(s) || jsonb_build_object(
    'files', coalesce((select jsonb_agg(to_jsonb(f) order by f.position, f.created_at)
                       from public.submission_files f where f.submission_id = s.id), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('reviewer', public.mini_profile_json(r.reviewer_id)) order by r.created_at)
                         from public.submission_reviews r where r.submission_id = s.id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('author', public.mini_profile_json(m.author_id)) order by m.created_at)
                          from public.submission_comments m where m.submission_id = s.id), '[]'::jsonb))
  from public.submissions s where s.id = p_submission;
$function$;

-- can_access_originals(uuid) ACL was: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

-- Storage policies as they were (0025 replaced them with 'submission previews read')
drop policy if exists "submission previews read" on storage.objects;
drop policy if exists "submission objects read" on storage.objects;
create policy "submission objects read" on storage.objects for select to authenticated
  using (((bucket_id = ANY (ARRAY['submissions'::text, 'submission-previews'::text])) AND can_read_submission_object(bucket_id, name)));
drop policy if exists "submission originals own draft delete" on storage.objects;
create policy "submission originals own draft delete" on storage.objects for delete to authenticated
  using (((bucket_id = 'submissions'::text) AND is_own_draft_path(name)));
drop policy if exists "submission originals own draft insert" on storage.objects;
create policy "submission originals own draft insert" on storage.objects for insert to authenticated
  with check (((bucket_id = 'submissions'::text) AND is_own_draft_path(name)));

-- submission_files privileges as they were
revoke select on public.submission_files from anon, authenticated;
grant delete, select on public.submission_files to authenticated;
-- (column-level SELECT before 0025: 20 column grants, covered by the table grant above)

do $do$ begin
  if to_regclass('private.schema_migrations') is not null then
    delete from private.schema_migrations where name = '0025_clean_files_after_release.sql';
  end if;
end $do$;
notify pgrst, 'reload schema';
