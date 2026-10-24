-- 0028: reliable ID-image retention purge. Safe with the app before it (that code ignores the result of
-- identity_image_purged). Rollback: supabase/rollback/0028_down.sql.

-- Marks an ID image as purged only when it's really gone from storage, once: the row is locked, so a concurrent or
-- repeated run gets 'already_marked' and no second audit entry. Returns 'marked' | 'already_marked' | 'object_present'.
drop function public.identity_image_purged(uuid);
create function public.identity_image_purged(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_path text;
begin
  select i.id_image_path into v_path from public.identity_verifications i
  where i.id = p_id and i.image_deleted_at is null
  for update;
  if not found then return 'already_marked'; end if;
  if v_path is not null and exists (
      select 1 from storage.objects o where o.bucket_id = 'identity-documents' and o.name = v_path) then
    return 'object_present';
  end if;
  update public.identity_verifications set image_deleted_at = now(), id_image_path = null where id = p_id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (null, 'identity_image_deleted', 'identity_verification', p_id::text, '{"reason": "retention"}'::jsonb);
  return 'marked';
end $$;

-- Report-only: stored ID images that no verification row points at (e.g. an upload whose submission failed and whose
-- cleanup didn't go through), older than p_min_age_hours so in-flight uploads aren't reported. Deletes nothing.
create function public.identity_orphan_images(p_min_age_hours int default 24, p_limit int default 200)
returns table (name text, created_at timestamptz, size bigint)
language sql stable security definer set search_path = public as $$
  select o.name, o.created_at, nullif(o.metadata->>'size', '')::bigint
  from storage.objects o
  where o.bucket_id = 'identity-documents'
    and o.created_at < now() - make_interval(hours => greatest(p_min_age_hours, 0))
    and not exists (select 1 from public.identity_verifications i where i.id_image_path = o.name)
  order by o.created_at
  limit greatest(least(p_limit, 1000), 1);
$$;

revoke all on function public.identity_image_purged(uuid), public.identity_orphan_images(int, int) from public, anon, authenticated;
grant execute on function public.identity_image_purged(uuid), public.identity_orphan_images(int, int) to service_role;
