-- Rollback of 0028_identity_purge_reliability.sql: restores identity_image_purged as it was at 0027_drop_tool_workflow_verification.sql
-- (captured 2026-10-24T12:50:19.978Z) and drops identity_orphan_images. No data changes.
-- Usage: psql "$SUPABASE_DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/rollback/0028_down.sql
set local lock_timeout = '5s';

drop function public.identity_orphan_images(int, int);
drop function public.identity_image_purged(uuid);
CREATE OR REPLACE FUNCTION public.identity_image_purged(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.identity_verifications set image_deleted_at = now(), id_image_path = null where id = p_id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (null, 'identity_image_deleted', 'identity_verification', p_id::text, '{"reason": "retention"}'::jsonb);
$function$;

revoke all on function public.identity_image_purged(uuid) from public, anon, authenticated;
grant execute on function public.identity_image_purged(uuid) to service_role;

delete from private.schema_migrations where name = '0028_identity_purge_reliability.sql';
