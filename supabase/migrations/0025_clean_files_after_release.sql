-- 0025: Clean (un-watermarked) originals unlock only after the payment is released.
-- * The originals bucket ("submissions") has no client read access at all — not for the brand, not for the creator.
--   The only way to a clean file is GET /api/submissions/:id/files/:fileId/original, which checks the rule on the
--   server and returns a 60-second signed URL. Watermarked previews stay readable as before.
-- * The brand's rule is: owns the campaign, the submission is approved, escrow.status = 'released' (released is final;
--   refund / dispute / cancel can only happen before it, so any other state keeps the files locked).
-- * Clean-file storage paths are no longer readable by clients (column privilege) or returned in submission JSON.
-- Safe to apply before the new app is live: the previous app's download buttons (which needed storage_path) just
-- disappear until it ships — the files fail closed, previews and everything else keep working.

-- 1. The rule, kept identical to the server route's check (the creator; or the brand once approved + released)
create or replace function public.can_access_originals(p_submission uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.submissions s
    join public.campaigns c on c.id = s.campaign_id
    left join public.escrow_payments e on e.campaign_creator_id = s.project_id
    where s.id = p_submission
      and (s.creator_id = auth.uid()
           or (c.brand_id = auth.uid() and s.status = 'approved' and e.status = 'released')));
$$;

-- 2. Storage: previews readable by the parties; originals not readable by any client
drop policy if exists "submission objects read" on storage.objects;
drop policy if exists "submission previews read" on storage.objects;
create policy "submission previews read" on storage.objects for select to authenticated
  using (bucket_id = 'submission-previews' and public.can_view_submission(public.uuid_or_null(split_part(name, '/', 2))));

-- 3. The original's storage path is server-only
revoke select on public.submission_files from anon, authenticated;
grant select (id, submission_id, position, kind, media_type, file_name, mime_type, size_bytes, preview_path, thumbnail_path,
              frame_paths, preview_kind, width, height, duration_ms, sha256, link_url, palette, created_at)
  on public.submission_files to authenticated;

create or replace function public.submission_json(p_submission uuid)
returns jsonb language sql stable set search_path = public as $$
  select to_jsonb(s) || jsonb_build_object(
    'files', coalesce((select jsonb_agg(to_jsonb(t) order by t.position, t.created_at)
                       from (select f.id, f.submission_id, f.position, f.kind, f.media_type, f.file_name, f.mime_type, f.size_bytes,
                                    f.preview_path, f.thumbnail_path, f.frame_paths, f.preview_kind, f.width, f.height, f.duration_ms,
                                    f.sha256, f.link_url, f.palette, f.created_at
                             from public.submission_files f where f.submission_id = s.id) t), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('reviewer', public.mini_profile_json(r.reviewer_id)) order by r.created_at)
                         from public.submission_reviews r where r.submission_id = s.id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('author', public.mini_profile_json(m.author_id)) order by m.created_at)
                          from public.submission_comments m where m.submission_id = s.id), '[]'::jsonb))
  from public.submissions s where s.id = p_submission;
$$;

revoke all on function public.can_access_originals(uuid) from public, anon;
grant execute on function public.can_access_originals(uuid) to authenticated, service_role;
