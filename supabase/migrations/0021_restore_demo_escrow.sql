-- 0021: Restore the internal demo escrow (undo the escrow-at-hire / Razorpay schema).
--
-- The escrow-at-hire change (Razorpay / demo funding at hire, creator claims, payment-gated downloads) was applied to
-- Supabase as 0021_escrow_at_hire.sql and 0022_late_payment_refund.sql, then reverted in code; those files are kept on
-- the git branch backup/before-revert only. This migration puts the database back to the schema of 0001–0020:
--   * escrow_payments / payment_events: old columns (whole-unit amounts, internal provider), old status + event checks
--   * campaign_creators: no 'hire_pending'
--   * the old hire / fund / release / refund / cancel functions and the pre-0021 versions of every function 0021 changed
--   * the original submissions-bucket storage policies
--   * drops creator_payout_methods, asset_downloads and the service-role pay_* functions
-- Existing rows are mapped to the old states (no money was ever real: every escrow is internal/demo):
--   escrow pending_funding / expired → unfunded, claimable / payout_failed → funded, funded / released / refunded /
--   disputed unchanged; project hire_pending → hired (the old flow hires first and funds later).
-- Ledger rows for events the old ledger doesn't know (e.g. 'claimable') are removed; the rest keep their history.
-- On a database that never had 0021/0022 (fresh setup) every step is a no-op.

-- ---------------------------------------------------------------------------
-- 1. Safety: never relabel real Razorpay money as internal test escrow
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'escrow_payments' and column_name = 'razorpay_payment_id') then
    if exists (select 1 from public.escrow_payments where razorpay_payment_id is not null or provider = 'razorpay') then
      raise exception 'Razorpay-funded escrows exist. Refund or settle them before restoring the demo escrow.';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Functions added by 0021 / 0022
-- ---------------------------------------------------------------------------
drop function if exists public.pay_hire(uuid, uuid, uuid, bigint, text, bigint, text);
drop function if exists public.pay_set_order(uuid, uuid, text, bigint);
drop function if exists public.pay_fund(uuid, text, uuid, text, text, text, jsonb);
drop function if exists public.pay_payment_failed(uuid, text, text, jsonb);
drop function if exists public.pay_begin_payout(uuid, uuid, text, uuid);
drop function if exists public.pay_set_payout_ref(uuid, text);
drop function if exists public.pay_payout_result(text, text, text, text, jsonb, uuid);
drop function if exists public.pay_cancel(uuid, uuid, text);
drop function if exists public.pay_cancel_after_refund(uuid, uuid, text, text, boolean);
drop function if exists public.pay_refunded(uuid, text, text, jsonb);
drop function if exists public.pay_late_refund(uuid, text, text, text, jsonb);
drop function if exists public.pay_expire_stale();
drop function if exists public.pay_claim_reminders();
drop function if exists public.remind_creator(uuid);
drop function if exists private.pay_do_release(uuid, uuid, text, text, jsonb);
drop function if exists private.pay_expire(public.escrow_payments, uuid, text);
drop function if exists private.ledger(public.escrow_payments, text, text, text, uuid, text, text, jsonb, text);
drop function if exists private.money_event(public.escrow_payments, text, uuid, text, jsonb);
drop function if exists private.event_seen(text);
drop function if exists private.escrow_status_of(uuid);
drop function if exists private.money_minor(bigint, text);
drop function if exists private.provider_label(text);

-- ---------------------------------------------------------------------------
-- 3. Tables and data (only where 0021 ran)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'escrow_payments' and column_name = 'amount_paise') then
    return;
  end if;

  -- Data moves below must not fire workflow checks, notifications or the ledger's append-only guard
  alter table public.payment_events disable trigger payment_events_immutable;
  alter table public.escrow_payments disable trigger escrow_payments_guard;
  alter table public.campaign_creators disable trigger campaign_creators_transition;
  alter table public.campaign_creators disable trigger campaign_creators_status_event;

  -- escrow_payments ---------------------------------------------------------
  alter table public.escrow_payments
    drop constraint if exists escrow_payments_status_check,
    drop constraint if exists escrow_payments_provider_check,
    drop constraint if exists escrow_funded_has_provider,
    drop constraint if exists escrow_razorpay_inr,
    add column amount integer,
    add column platform_fee integer,
    add column provider_ref text;

  update public.escrow_payments e set
    status = case e.status
      when 'pending_funding' then 'unfunded' when 'expired' then 'unfunded'
      when 'claimable' then 'funded' when 'payout_failed' then 'funded'
      else e.status end,
    -- 0021 stored the creator's amount as net (the old fee was charged on top); amounts were whole units before
    amount = greatest(1, round(e.net_amount_paise / 100.0))::int,
    platform_fee = case when e.status in ('pending_funding', 'expired')
                        then ceil(greatest(1, round(e.net_amount_paise / 100.0)) * 0.08)::int  -- old hire fee, re-set on funding
                        else round(e.platform_fee_paise / 100.0)::int end,
    provider = 'internal'
  where true;

  -- Old flow: a hire is confirmed immediately and escrow is funded later
  update public.campaign_creators set status = 'hired', hired_at = coalesce(hired_at, created_at) where status = 'hire_pending';

  alter table public.escrow_payments
    drop column payout_method_id,
    drop column amount_paise, drop column platform_fee_paise, drop column net_amount_paise,
    drop column payout_provider, drop column razorpay_order_id, drop column razorpay_payment_id, drop column razorpay_refund_id,
    drop column payout_ref, drop column payout_status, drop column payout_attempts, drop column claimable_at,
    drop column expires_at, drop column idempotency_key, drop column last_reminder_at, drop column failure_reason;
  drop index if exists public.escrow_status_idx;
  alter table public.escrow_payments
    alter column amount set not null,
    alter column platform_fee set default 0,
    alter column platform_fee set not null,
    alter column provider set default 'internal',
    alter column provider set not null,
    add constraint escrow_payments_amount_check check (amount > 0),
    add constraint escrow_payments_platform_fee_check check (platform_fee >= 0),
    add constraint escrow_payments_provider_check check (provider = any (array['internal', 'stripe_test'])),
    add constraint escrow_payments_provider_ref_check check (char_length(provider_ref) <= 200),
    add constraint escrow_payments_status_check check (status = any (array['unfunded', 'funded', 'released', 'refunded', 'disputed']));

  -- payment_events (append-only ledger) ---------------------------------------
  delete from public.payment_events
  where event not in ('created', 'amount_set', 'funded', 'released', 'refunded', 'disputed');
  alter table public.payment_events drop constraint if exists payment_events_event_check, add column amount integer;
  update public.payment_events set
    amount = round(amount_paise / 100.0)::int,
    from_status = case from_status when 'pending_funding' then 'unfunded' when 'expired' then 'unfunded'
                                   when 'claimable' then 'funded' when 'payout_failed' then 'funded' else from_status end,
    to_status = case to_status when 'pending_funding' then 'unfunded' when 'expired' then 'unfunded'
                               when 'claimable' then 'funded' when 'payout_failed' then 'funded' else to_status end
  where true;
  drop index if exists public.payment_events_provider_event_uq;
  alter table public.payment_events
    drop column amount_paise, drop column provider, drop column provider_event_id, drop column payload,
    alter column amount set not null,
    add constraint payment_events_event_check check (event = any (array['created', 'amount_set', 'funded', 'released', 'refunded', 'disputed']));

  -- campaign_creators ---------------------------------------------------------
  alter table public.campaign_creators drop constraint campaign_creators_status_check;
  alter table public.campaign_creators add constraint campaign_creators_status_check check (status = any (array[
    'applied', 'shortlisted', 'hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted',
    'approved', 'completed', 'rejected', 'cancelled']));

  alter table public.payment_events enable trigger payment_events_immutable;
  alter table public.escrow_payments enable trigger escrow_payments_guard;
  alter table public.campaign_creators enable trigger campaign_creators_transition;
  alter table public.campaign_creators enable trigger campaign_creators_status_event;
end $$;

drop table if exists public.creator_payout_methods;
drop table if exists public.asset_downloads;

-- ---------------------------------------------------------------------------
-- 4. Storage: the original submissions-bucket policies (creator uploads own draft files; parties read via the check)
-- ---------------------------------------------------------------------------
drop policy if exists "submission previews read" on storage.objects;
drop policy if exists "submission objects read" on storage.objects;
drop policy if exists "submission originals own draft insert" on storage.objects;
drop policy if exists "submission originals own draft delete" on storage.objects;
create policy "submission objects read" on storage.objects for select to authenticated
  using (((bucket_id = any (array['submissions'::text, 'submission-previews'::text])) and public.can_read_submission_object(bucket_id, name)));
create policy "submission originals own draft delete" on storage.objects for delete to authenticated
  using (((bucket_id = 'submissions'::text) and public.is_own_draft_path(name)));
create policy "submission originals own draft insert" on storage.objects for insert to authenticated
  with check (((bucket_id = 'submissions'::text) and public.is_own_draft_path(name)));

-- ---------------------------------------------------------------------------
-- 5. Functions: the exact pre-0021 definitions and privileges
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.escrow_move(p_e public.escrow_payments, p_to text, p_actor uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_label text := private.money(p_e.amount, p_e.currency);
begin
  update public.escrow_payments set status = p_to,
    funded_at = case when p_to = 'funded' then now() else funded_at end,
    released_at = case when p_to = 'released' then now() else released_at end,
    refunded_at = case when p_to = 'refunded' then now() else refunded_at end,
    disputed_at = case when p_to = 'disputed' then now() else disputed_at end
  where id = p_e.id;
  insert into public.payment_events (escrow_id, actor_id, event, from_status, to_status, amount, currency, note)
  values (p_e.id, p_actor, p_to, p_e.status, p_to, p_e.amount, p_e.currency, p_note);
  insert into public.project_events (project_id, actor_id, kind, event, note, data)
  values (p_e.campaign_creator_id, p_actor, 'payment', p_to, p_note,
          jsonb_build_object('amount', p_e.amount, 'currency', p_e.currency, 'amount_label', v_label,
                             'platform_fee', p_e.platform_fee, 'test_mode', true));
end $function$
;

revoke all on function private.escrow_move(public.escrow_payments,text,uuid,text) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.event_text(p_kind text, p_event text, p_title text, p_note text, p_data jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select left(case p_kind
    when 'payment' then case p_event
      when 'funded' then format('Escrow funded for “%s”: %s. Test mode — no real money moved.', p_title, p_data->>'amount_label')
      when 'released' then format('Payment released for “%s”: %s. Test mode — no real money moved.', p_title, p_data->>'amount_label')
      when 'refunded' then format('Escrow refunded for “%s”.%s', p_title, coalesce(' Reason: ' || p_note, ''))
      when 'disputed' then format('Payment for “%s” is disputed.%s', p_title, coalesce(' Reason: ' || p_note, ''))
      else format('Payment update on “%s”.', p_title) end
    when 'certificate' then format('Commercial licence record %s issued for “%s”.', p_data->>'certificate_id', p_title)
    else case p_event
      when 'applied' then format('Applied to “%s”.', p_title)
      when 'shortlisted' then format('Shortlisted for “%s”.', p_title)
      when 'hired' then format('Hired for “%s”%s.', p_title, coalesce(' at ' || (p_data->>'amount_label'), ''))
      when 'in_progress' then format('Work started on “%s”.', p_title)
      when 'submitted' then format('Version %s submitted for review on “%s”.', coalesce(p_data->>'version', '1'), p_title)
      when 'resubmitted' then format('Revised version %s submitted on “%s”.', coalesce(p_data->>'version', '?'), p_title)
      when 'revision_requested' then format('Revision requested on “%s”: %s', p_title, coalesce(p_note, ''))
      when 'approved' then format('Version %s of “%s” approved.', coalesce(p_data->>'version', '?'), p_title)
      when 'completed' then format('“%s” is complete. Thanks for working together!', p_title)
      when 'rejected' then format('The submission for “%s” was rejected.%s', p_title, coalesce(' ' || p_note, ''))
      when 'cancelled' then format('The project “%s” was cancelled.%s', p_title, coalesce(' Reason: ' || p_note, ''))
      else format('Project update on “%s”.', p_title) end
  end, 4000);
$function$
;

revoke all on function private.event_text(text,text,text,text,jsonb) from public, anon, authenticated, service_role;

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
$function$
;

revoke all on function public.can_access_originals(uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_access_originals(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_project(p_project uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_me uuid := private.assert_active(); v_x public.campaign_creators; v_e public.escrow_payments; v_reason text := nullif(trim(p_reason), '');
begin
  select x.* into v_x from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
  where x.id = p_project and (c.brand_id = v_me or public.is_admin()) for update of x;
  if not found then raise exception 'Project not found' using errcode = '42501'; end if;
  if char_length(coalesce(v_reason, '')) < 5 then raise exception 'Give a short reason for cancelling' using errcode = '23514'; end if;
  perform private.set_context(v_me, v_reason);
  update public.campaign_creators set status = 'cancelled' where id = p_project;
  -- Funded escrow goes straight back to the brand
  select * into v_e from public.escrow_payments where campaign_creator_id = p_project for update;
  if v_e.status = 'funded' then
    perform private.escrow_move(v_e, 'refunded', v_me, v_reason);
  end if;
end $function$
;

revoke all on function public.cancel_project(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_project(uuid,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_submission(p_project uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := private.assert_active();
  v_x public.campaign_creators;
  v_sprint boolean;
  v_id uuid;
begin
  select * into v_x from public.campaign_creators where id = p_project and creator_id = v_me for update;
  if v_x.id is null then raise exception 'Project not found' using errcode = '42501'; end if;
  select is_sprint into v_sprint from public.campaigns where id = v_x.campaign_id;
  if public.sprint_closed(v_x.campaign_id) then
    raise exception 'This sprint closed at its deadline — submissions are no longer accepted' using errcode = '23514';
  end if;
  if not (v_x.status in ('hired', 'in_progress', 'revision_requested')
          or (v_sprint and v_x.status in ('applied', 'shortlisted'))) then
    if v_x.status in ('submitted', 'resubmitted') then
      raise exception 'Your latest version is awaiting review' using errcode = '23514';
    end if;
    raise exception 'You can''t submit work while the project is %', replace(v_x.status, '_', ' ') using errcode = '23514';
  end if;

  select id into v_id from public.submissions where project_id = p_project and status = 'draft';
  if v_id is not null then return v_id; end if;

  insert into public.submissions (project_id, campaign_id, creator_id, version)
  values (p_project, v_x.campaign_id, v_me,
          coalesce((select max(version) from public.submissions where project_id = p_project), 0) + 1)
  returning id into v_id;

  if v_x.status = 'hired' then
    perform private.set_context(v_me);
    update public.campaign_creators set status = 'in_progress' where id = p_project;
  end if;
  return v_id;
end $function$
;

revoke all on function public.create_submission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_submission(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dispute_escrow(p_project uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_me uuid := private.assert_active(); v_e public.escrow_payments; v_reason text := nullif(trim(p_reason), '');
begin
  if public.project_role(p_project) not in ('creator', 'brand') then raise exception 'Project not found' using errcode = '42501'; end if;
  if char_length(coalesce(v_reason, '')) < 10 then raise exception 'Describe the problem in a sentence or two' using errcode = '23514'; end if;
  select * into v_e from public.escrow_payments where campaign_creator_id = p_project for update;
  if v_e.id is null or v_e.status <> 'funded' then raise exception 'Only funded escrow can be disputed'; end if;
  perform private.escrow_move(v_e, 'disputed', v_me, v_reason);
end $function$
;

revoke all on function public.dispute_escrow(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.dispute_escrow(uuid,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.escrow_transition_allowed(p_from text, p_to text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select (p_from, p_to) in (
    ('unfunded', 'funded'), ('funded', 'released'), ('funded', 'refunded'), ('funded', 'disputed'),
    ('disputed', 'released'), ('disputed', 'refunded'));
$function$
;

revoke all on function public.escrow_transition_allowed(text,text) from public, anon, authenticated, service_role;
grant execute on function public.escrow_transition_allowed(text,text) to public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fund_escrow(p_project uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_me uuid := private.assert_active(); v_x public.campaign_creators; v_e public.escrow_payments;
begin
  select x.* into v_x from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
  where x.id = p_project and c.brand_id = v_me;
  if not found then raise exception 'Project not found' using errcode = '42501'; end if;
  if v_x.status in ('rejected', 'cancelled', 'completed') then raise exception 'This project is %', v_x.status; end if;
  select * into v_e from public.escrow_payments where campaign_creator_id = p_project for update;
  if v_e.id is null then raise exception 'Hire the creator first to set an amount' using errcode = '23514'; end if;
  if v_e.status <> 'unfunded' then raise exception 'Escrow is already %', v_e.status; end if;
  perform private.escrow_move(v_e, 'funded', v_me, 'Funded by the brand (test mode)');
end $function$
;

revoke all on function public.fund_escrow(uuid) from public, anon, authenticated, service_role;
grant execute on function public.fund_escrow(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_deliveries(p_filter text DEFAULT 'active'::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(project jsonb, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.project_summary(x.id), count(*) over ()
  from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
  where c.brand_id = auth.uid() and x.hired_at is not null
    and case coalesce(p_filter, 'all')
      when 'active' then x.status in ('hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved')
      when 'completed' then x.status = 'completed'
      when 'closed' then x.status in ('rejected', 'cancelled')
      else true end
  order by (x.status = 'approved') desc, x.status_changed_at desc, x.id
  limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0);
$function$
;

revoke all on function public.get_deliveries(text,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.get_deliveries(text,integer,integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_projects(p_filter text DEFAULT 'active'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(project jsonb, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.project_summary(x.id), count(*) over ()
  from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
  where x.creator_id = auth.uid()
    and case coalesce(p_filter, 'all')
      when 'active' then x.status in ('hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved')
                      or (c.is_sprint and x.status in ('applied', 'shortlisted'))
      when 'completed' then x.status = 'completed'
      when 'closed' then x.status in ('rejected', 'cancelled')
      else true end
  order by (x.status = 'revision_requested') desc, x.status_changed_at desc, x.id
  limit greatest(least(p_limit, 50), 1) offset greatest(p_offset, 0);
$function$
;

revoke all on function public.get_my_projects(text,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.get_my_projects(text,integer,integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hire_creator(p_campaign uuid, p_creator uuid, p_amount integer, p_currency text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := private.assert_active();
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
    values (p_campaign, p_creator, 'hired', now(), p_amount, v_cur) returning * into v_x;
  else
    if v_x.status in ('approved', 'completed', 'rejected', 'cancelled') then
      raise exception 'This project is already %', replace(v_x.status, '_', ' ');
    end if;
    update public.campaign_creators set agreed_amount = p_amount, currency = v_cur, hired_at = coalesce(hired_at, now())
      where id = v_x.id;
    if v_x.status in ('applied', 'shortlisted') then
      update public.campaign_creators set status = 'hired' where id = v_x.id;
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
end $function$
;

revoke all on function public.hire_creator(uuid,uuid,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.hire_creator(uuid,uuid,integer,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.project_summary(p_project uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', x.id, 'status', x.status, 'campaign_id', x.campaign_id, 'creator_id', x.creator_id,
    'agreed_amount', x.agreed_amount, 'currency', x.currency, 'payment_status', x.payment_status, 'paid_at', x.paid_at,
    'hired_at', x.hired_at, 'started_at', x.started_at, 'completed_at', x.completed_at,
    'status_changed_at', x.status_changed_at, 'created_at', x.created_at,
    'campaign', jsonb_build_object('id', c.id, 'title', c.title, 'status', c.status, 'deadline', c.deadline,
                  'is_sprint', c.is_sprint, 'sprint_deadline', c.sprint_deadline,
                  'sprint_closed', c.is_sprint and c.sprint_deadline <= now(),
                  'budget_min', c.budget_min, 'budget_max', c.budget_max, 'currency', c.currency,
                  'brand', public.mini_profile_json(c.brand_id)),
    'creator', public.mini_profile_json(x.creator_id),
    'escrow', (select jsonb_build_object('id', e.id, 'status', e.status, 'amount', e.amount, 'currency', e.currency,
                 'platform_fee', e.platform_fee, 'provider', e.provider, 'funded_at', e.funded_at,
                 'released_at', e.released_at, 'refunded_at', e.refunded_at, 'disputed_at', e.disputed_at)
               from public.escrow_payments e where e.campaign_creator_id = x.id),
    'latest_submission', (select jsonb_build_object('id', s.id, 'version', s.version, 'status', s.status,
                            'submitted_at', s.submitted_at, 'reviewed_at', s.reviewed_at)
                          from public.submissions s where s.project_id = x.id order by s.version desc limit 1),
    'certificate_id', (select certificate_id from public.ip_certificates where campaign_creator_id = x.id)
  )
  from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
  where x.id = p_project;
$function$
;

revoke all on function public.project_summary(uuid) from public, anon, authenticated, service_role;
grant execute on function public.project_summary(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.project_transition_allowed(p_from text, p_to text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select (p_from, p_to) in (
    ('applied', 'shortlisted'), ('applied', 'hired'), ('applied', 'submitted'), ('applied', 'rejected'), ('applied', 'cancelled'),
    ('shortlisted', 'applied'), ('shortlisted', 'hired'), ('shortlisted', 'submitted'), ('shortlisted', 'rejected'), ('shortlisted', 'cancelled'),
    ('hired', 'in_progress'), ('hired', 'submitted'), ('hired', 'cancelled'),
    ('in_progress', 'submitted'), ('in_progress', 'cancelled'),
    ('submitted', 'revision_requested'), ('submitted', 'approved'), ('submitted', 'rejected'), ('submitted', 'cancelled'),
    ('revision_requested', 'resubmitted'), ('revision_requested', 'rejected'), ('revision_requested', 'cancelled'),
    ('resubmitted', 'submitted'), ('resubmitted', 'revision_requested'), ('resubmitted', 'approved'),
    ('resubmitted', 'rejected'), ('resubmitted', 'cancelled'),
    ('approved', 'completed')
  );
$function$
;

revoke all on function public.project_transition_allowed(text,text) from public, anon, authenticated, service_role;
grant execute on function public.project_transition_allowed(text,text) to public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refund_escrow(p_project uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_me uuid := private.assert_active(); v_x public.campaign_creators; v_e public.escrow_payments; v_admin boolean := public.is_admin();
begin
  select x.* into v_x from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
  where x.id = p_project and (c.brand_id = v_me or v_admin);
  if not found then raise exception 'Project not found' using errcode = '42501'; end if;
  select * into v_e from public.escrow_payments where campaign_creator_id = p_project for update;
  if v_e.id is null or v_e.status not in ('funded', 'disputed') then raise exception 'There is no funded escrow to refund'; end if;
  if v_e.status = 'disputed' and not v_admin then raise exception 'A disputed payment is resolved by the Creatora team'; end if;
  if v_x.status not in ('rejected', 'cancelled') and not v_admin then
    raise exception 'Refunds are only possible after the work is rejected or the project is cancelled' using errcode = '23514';
  end if;
  perform private.escrow_move(v_e, 'refunded', v_me, nullif(trim(p_reason), ''));
end $function$
;

revoke all on function public.refund_escrow(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.refund_escrow(uuid,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.release_escrow(p_project uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := private.assert_active();
  v_x public.campaign_creators;
  v_c public.campaigns;
  v_e public.escrow_payments;
  v_s public.submissions;
  v_code text;
  v_g public.brand_guidelines;
begin
  select x.* into v_x from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
  where x.id = p_project and c.brand_id = v_me for update of x;
  if not found then raise exception 'Project not found' using errcode = '42501'; end if;
  select * into v_c from public.campaigns where id = v_x.campaign_id;
  if v_x.status <> 'approved' then raise exception 'Approve a submission before releasing payment' using errcode = '23514'; end if;
  select * into v_e from public.escrow_payments where campaign_creator_id = p_project for update;
  if v_e.id is null or v_e.status <> 'funded' then
    raise exception 'Fund escrow before releasing payment' using errcode = '23514';
  end if;
  select * into v_s from public.submissions where project_id = p_project and status = 'approved' order by version desc limit 1;
  select * into v_g from public.brand_guidelines where id = v_c.guideline_id;

  perform private.escrow_move(v_e, 'released', v_me, 'Released on final approval (test mode)');
  update public.campaign_creators set payment_status = 'paid', paid_at = now(),
    agreed_amount = v_e.amount, currency = v_e.currency where id = p_project;
  perform private.set_context(v_me, null, jsonb_build_object('submission_id', v_s.id, 'version', v_s.version));
  update public.campaign_creators set status = 'completed' where id = p_project;

  loop
    v_code := private.certificate_code();
    exit when not exists (select 1 from public.ip_certificates where certificate_id = v_code);
  end loop;
  insert into public.ip_certificates (certificate_id, campaign_creator_id, campaign_id, brand_id, creator_id, submission_id,
                                      terms, tools_declared, asset_hashes)
  values (v_code, p_project, v_c.id, v_c.brand_id, v_x.creator_id, v_s.id,
    jsonb_build_object(
      'campaign_title', v_c.title,
      'brand', (select coalesce(bd.company_name, p.display_name) from public.profiles p
                left join public.brand_details bd on bd.profile_id = p.id where p.id = v_c.brand_id),
      'creator', (select display_name from public.profiles where id = v_x.creator_id),
      'creator_username', (select username from public.profiles where id = v_x.creator_id),
      'usage_rights', to_jsonb(v_c.usage_rights), 'territory', v_c.territory, 'usage_duration', v_c.usage_duration,
      'exclusivity', v_c.exclusivity, 'license_type', v_c.license_type,
      'ai_disclosure_required', v_c.ai_disclosure_required, 'ip_terms', v_c.ip_terms,
      'amount', v_e.amount, 'currency', v_e.currency, 'payment_mode', 'internal_test_mode',
      'submission_version', v_s.version, 'approved_at', v_s.reviewed_at,
      'guideline_version', v_g.version, 'ai_generated_declared', v_s.ai_generated_declared),
    coalesce(v_s.tools_used, '{}'),
    coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(f.file_name, f.link_url), 'media_type', f.media_type,
                                                  'sha256', f.sha256, 'bytes', f.size_bytes, 'link', f.link_url) order by f.position)
              from public.submission_files f where f.submission_id = v_s.id), '[]'::jsonb));
  insert into public.project_events (project_id, actor_id, kind, event, data)
  values (p_project, v_me, 'certificate', 'issued', jsonb_build_object('certificate_id', v_code));
  return v_code;
end $function$
;

revoke all on function public.release_escrow(uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_escrow(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_submission(p_submission uuid, p_decision text, p_feedback text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := private.assert_active();
  v_s public.submissions;
  v_x public.campaign_creators;
  v_fb text := nullif(trim(p_feedback), '');
begin
  if p_decision not in ('approved', 'revision_requested', 'rejected') then raise exception 'Unknown decision'; end if;
  select s.* into v_s from public.submissions s join public.campaigns c on c.id = s.campaign_id
  where s.id = p_submission and c.brand_id = v_me for update of s;
  if not found then raise exception 'Submission not found' using errcode = '42501'; end if;
  if v_s.status <> 'submitted' then raise exception 'This version was already reviewed'; end if;
  if v_s.version <> (select max(version) from public.submissions where project_id = v_s.project_id and status <> 'draft') then
    raise exception 'A newer version exists — review that one instead';
  end if;
  if p_decision <> 'approved' and char_length(coalesce(v_fb, '')) < 5 then
    raise exception 'Add feedback so the creator knows what to change' using errcode = '23514';
  end if;
  select * into v_x from public.campaign_creators where id = v_s.project_id for update;
  if p_decision = 'approved' and v_x.hired_at is null then
    raise exception 'Hire this creator first — that sets the amount and opens escrow' using errcode = '23514';
  end if;

  insert into public.submission_reviews (submission_id, reviewer_id, decision, feedback) values (p_submission, v_me, p_decision, v_fb);
  update public.submissions set status = p_decision, reviewed_at = now() where id = p_submission;
  perform private.set_context(v_me, v_fb, jsonb_build_object('submission_id', p_submission, 'version', v_s.version));
  update public.campaign_creators set status = p_decision where id = v_x.id;
end $function$
;

revoke all on function public.review_submission(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.review_submission(uuid,text,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_submission(p_submission uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := private.assert_active();
  v_s public.submissions;
  v_x public.campaign_creators;
  v_to text;
begin
  select * into v_s from public.submissions where id = p_submission and creator_id = v_me for update;
  if not found then raise exception 'Submission not found' using errcode = '42501'; end if;
  if v_s.status <> 'draft' then raise exception 'This version was already submitted'; end if;
  if not exists (select 1 from public.submission_files where submission_id = p_submission) then
    raise exception 'Add at least one file or link before submitting' using errcode = '23514';
  end if;
  if not (v_s.ai_generated_declared and v_s.commercial_terms_accepted) then
    raise exception 'Confirm the AI-generation and commercial-use declaration before submitting' using errcode = '23514';
  end if;

  select * into v_x from public.campaign_creators where id = v_s.project_id for update;
  v_to := case
    when v_x.status = 'revision_requested' then 'resubmitted'
    when v_x.status in ('hired', 'in_progress', 'applied', 'shortlisted') then 'submitted'
  end;
  if v_to is null then
    raise exception 'You can''t submit work while the project is %', replace(v_x.status, '_', ' ') using errcode = '23514';
  end if;

  update public.submissions set status = 'submitted', submitted_at = now() where id = p_submission;
  perform private.set_context(v_me, null, jsonb_build_object('submission_id', p_submission, 'version', v_s.version));
  update public.campaign_creators set status = v_to where id = v_x.id;
  insert into public.ai_review_results (submission_id) values (p_submission) on conflict (submission_id) do nothing;
end $function$
;

revoke all on function public.submit_submission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.submit_submission(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_escrow_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.status is distinct from old.status and not public.escrow_transition_allowed(old.status, new.status) then
    raise exception 'Invalid escrow transition: % → %', old.status, new.status using errcode = '23514';
  end if;
  if old.status <> 'unfunded' and (new.amount, new.currency, new.platform_fee) is distinct from (old.amount, old.currency, old.platform_fee) then
    raise exception 'The amount is locked once escrow is funded' using errcode = '23514';
  end if;
  return new;
end $function$
;

revoke all on function public.tg_escrow_guard() from public, anon, authenticated, service_role;
grant execute on function public.tg_escrow_guard() to public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_project_event_fanout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v record;
  v_body text;
  v_conv uuid;
  v_type text := case when new.kind = 'payment' then 'payment' else 'project' end;
  v_data jsonb;
begin
  if not new.notify then return null; end if;
  select x.creator_id, c.brand_id, c.title, c.id as campaign_id into v
  from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id where x.id = new.project_id;
  if not found then return null; end if;

  v_data := new.data || jsonb_build_object('event', new.event, 'kind', new.kind, 'campaign_title', v.title,
                                           'campaign_id', v.campaign_id, 'note', left(new.note, 200));
  -- The other party (both, when the change came from the platform itself)
  if new.actor_id is distinct from v.creator_id then
    perform public.notify(v.creator_id, new.actor_id, v_type, 'project', new.project_id, v_data);
  end if;
  if new.actor_id is distinct from v.brand_id then
    perform public.notify(v.brand_id, new.actor_id, v_type, 'project', new.project_id, v_data);
  end if;

  v_body := private.event_text(new.kind, new.event, v.title, new.note, new.data);
  v_conv := private.ensure_dm(v.brand_id, v.creator_id);
  insert into public.messages (conversation_id, sender_id, body, kind, created_at)
  values (v_conv, coalesce(new.actor_id, v.brand_id), v_body, 'system', new.created_at);
  return null;
end $function$
;

revoke all on function public.tg_project_event_fanout() from public, anon, authenticated, service_role;
grant execute on function public.tg_project_event_fanout() to service_role;

CREATE OR REPLACE FUNCTION public.tg_project_status_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.project_events (project_id, actor_id, kind, event, from_status, to_status, note, data, notify)
    values (new.id, private.ctx_actor(), 'status', new.status, null, new.status, private.ctx_note(), private.ctx_data(),
            new.status not in ('applied', 'shortlisted'));   -- applications/shortlists already notify on their own
  elsif new.status is distinct from old.status then
    insert into public.project_events (project_id, actor_id, kind, event, from_status, to_status, note, data, notify)
    values (new.id, private.ctx_actor(), 'status', new.status, old.status, new.status, private.ctx_note(), private.ctx_data(),
            new.status not in ('applied', 'shortlisted'));
  end if;
  return null;
end $function$
;

revoke all on function public.tg_project_status_event() from public, anon, authenticated, service_role;
grant execute on function public.tg_project_status_event() to service_role;

CREATE OR REPLACE FUNCTION public.tg_project_transition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if not public.project_transition_allowed(old.status, new.status) then
      raise exception 'Invalid project transition: % → %', old.status, new.status using errcode = '23514';
    end if;
    -- Submitting without being hired is only possible in a sprint (spec work before hiring)
    if new.status = 'submitted' and old.status in ('applied', 'shortlisted')
       and not exists (select 1 from public.campaigns where id = new.campaign_id and is_sprint) then
      raise exception 'You need to be hired before submitting work' using errcode = '23514';
    end if;
    new.status_changed_at := now();
    if new.status = 'in_progress' then new.started_at := coalesce(new.started_at, now()); end if;
    if new.status = 'completed' then new.completed_at := now(); end if;
  end if;
  return new;
end $function$
;

revoke all on function public.tg_project_transition() from public, anon, authenticated, service_role;
grant execute on function public.tg_project_transition() to public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unhire_creator(p_campaign uuid, p_creator uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_me uuid := private.assert_active(); v_x public.campaign_creators;
begin
  select x.* into v_x from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
  where x.campaign_id = p_campaign and x.creator_id = p_creator and c.brand_id = v_me;
  if not found then raise exception 'Project not found' using errcode = '42501'; end if;
  if v_x.status not in ('hired', 'applied', 'shortlisted')
     or exists (select 1 from public.submissions where project_id = v_x.id and status <> 'draft')
     or exists (select 1 from public.escrow_payments where campaign_creator_id = v_x.id and status <> 'unfunded') then
    raise exception 'Work or payment has started on this project — cancel it instead' using errcode = '23514';
  end if;
  delete from public.campaign_creators where id = v_x.id;
end $function$
;

revoke all on function public.unhire_creator(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.unhire_creator(uuid,uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Migration bookkeeping: 0021_escrow_at_hire / 0022_late_payment_refund are no longer in effect
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('private.schema_migrations') is not null then
    delete from private.schema_migrations where name in ('0021_escrow_at_hire.sql', '0022_late_payment_refund.sql');
  end if;
end $$;
