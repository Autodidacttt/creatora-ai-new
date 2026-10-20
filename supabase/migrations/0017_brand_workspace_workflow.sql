-- 0017: Brand workspace workflow — every project/payment change goes through these functions.
-- Each status change writes a timeline event (project_events); each event notifies the other party
-- and posts a system message into their conversation (triggers below).

-- ---------------------------------------------------------------------------
-- Actor / note / data for trigger-generated events (transaction-local settings)
-- ---------------------------------------------------------------------------
create or replace function private.set_context(p_actor uuid, p_note text default null, p_data jsonb default '{}'::jsonb)
returns void language sql as $$
  select set_config('app.actor', coalesce(p_actor::text, ''), true),
         set_config('app.note', coalesce(p_note, ''), true),
         set_config('app.data', coalesce(p_data, '{}'::jsonb)::text, true);
$$;

create or replace function private.ctx_actor() returns uuid language sql stable as $$
  select coalesce(public.uuid_or_null(nullif(current_setting('app.actor', true), '')), auth.uid());
$$;
create or replace function private.ctx_note() returns text language sql stable as $$
  select nullif(current_setting('app.note', true), '');
$$;
create or replace function private.ctx_data() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('app.data', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function private.assert_active() returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first' using errcode = '28000'; end if;
  if not public.is_active_user() then raise exception 'Your account is suspended' using errcode = '42501'; end if;
  return auth.uid();
end $$;

create or replace function private.money(p_amount int, p_currency text) returns text language sql immutable as $$
  select coalesce(p_currency, 'USD') || ' ' || to_char(coalesce(p_amount, 0), 'FM999,999,999');
$$;

-- ---------------------------------------------------------------------------
-- Status changes → timeline events
-- ---------------------------------------------------------------------------
create or replace function public.tg_project_status_event()
returns trigger language plpgsql security definer set search_path = public as $$
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
end $$;
create trigger campaign_creators_status_event after insert or update of status on public.campaign_creators
  for each row execute function public.tg_project_status_event();

-- The old "selected" notification is replaced by the "hired" project event
drop trigger if exists notify_selected on public.campaign_creators;

-- ---------------------------------------------------------------------------
-- Timeline events → notification for the other party + system message in their DM
-- ---------------------------------------------------------------------------
create or replace function private.event_text(p_kind text, p_event text, p_title text, p_note text, p_data jsonb)
returns text language sql immutable as $$
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
$$;

create or replace function private.ensure_dm(p_a uuid, p_b uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_key text := least(p_a::text, p_b::text) || ':' || greatest(p_a::text, p_b::text);
        v_id uuid;
begin
  insert into public.conversations (dm_key) values (v_key) on conflict (dm_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.conversations where dm_key = v_key; end if;
  insert into public.conversation_participants (conversation_id, user_id) values (v_id, p_a), (v_id, p_b) on conflict do nothing;
  return v_id;
end $$;

create or replace function public.tg_project_event_fanout()
returns trigger language plpgsql security definer set search_path = public as $$
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
end $$;
create trigger project_events_fanout after insert on public.project_events
  for each row execute function public.tg_project_event_fanout();

-- System messages are already covered by the project notification
create or replace function public.tg_notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.kind = 'system' then return null; end if;
  for r in
    select user_id from public.conversation_participants
    where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    update public.notifications
      set actor_id = new.sender_id,
          created_at = new.created_at,
          data = jsonb_build_object('excerpt', left(new.body, 120),
                   'count', coalesce((data->>'count')::int, 1) + 1)
      where user_id = r.user_id and type = 'message' and entity_id = new.conversation_id
        and read_at is null;
    if not found then
      perform public.notify(r.user_id, new.sender_id, 'message', 'conversation', new.conversation_id,
        jsonb_build_object('excerpt', left(new.body, 120), 'count', 1));
    end if;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Sprints: applying creates the project row (creators can submit spec work before the deadline)
-- ---------------------------------------------------------------------------
create or replace function public.tg_applications_sprint()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_x public.campaign_creators;
begin
  if not exists (select 1 from public.campaigns where id = new.campaign_id and is_sprint) then
    return null;
  end if;
  select * into v_x from public.campaign_creators where campaign_id = new.campaign_id and creator_id = new.creator_id;
  perform private.set_context(new.creator_id);
  if tg_op = 'INSERT' or (new.status = 'pending' and old.status <> 'pending') then
    if v_x.id is null then
      insert into public.campaign_creators (campaign_id, creator_id, status) values (new.campaign_id, new.creator_id, 'applied');
    end if;
  elsif new.status = 'withdrawn' and v_x.status in ('applied', 'shortlisted') then
    update public.campaign_creators set status = 'cancelled' where id = v_x.id;
  elsif new.status = 'rejected' and v_x.status in ('applied', 'shortlisted') then
    perform private.set_context(auth.uid());
    update public.campaign_creators set status = 'rejected' where id = v_x.id;
  end if;
  return null;
end $$;
create trigger applications_sprint after insert or update of status on public.campaign_applications
  for each row execute function public.tg_applications_sprint();

create or replace function public.tg_applications_sprint_guard()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT' or new.status = 'pending') and public.sprint_closed(new.campaign_id) then
    raise exception 'This sprint closed at its deadline' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger applications_sprint_guard before insert or update of status on public.campaign_applications
  for each row execute function public.tg_applications_sprint_guard();

-- Shortlisting a sprint entrant moves the project along (and back when removed)
create or replace function public.tg_shortlists_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform private.set_context(auth.uid());
  if tg_op = 'INSERT' then
    update public.campaign_creators set status = 'shortlisted'
      where campaign_id = new.campaign_id and creator_id = new.creator_id and status = 'applied';
  else
    update public.campaign_creators set status = 'applied'
      where campaign_id = old.campaign_id and creator_id = old.creator_id and status = 'shortlisted';
  end if;
  return null;
end $$;
create trigger shortlists_project after insert or delete on public.campaign_shortlists
  for each row execute function public.tg_shortlists_project();

-- ---------------------------------------------------------------------------
-- Hiring (sets the agreed amount and opens an unfunded escrow)
-- ---------------------------------------------------------------------------
create or replace function public.hire_creator(p_campaign uuid, p_creator uuid, p_amount int, p_currency text default null)
returns uuid language plpgsql security definer set search_path = public as $$
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
end $$;

-- Undo a hire before anything happened (no submitted work, escrow never funded)
create or replace function public.unhire_creator(p_campaign uuid, p_creator uuid)
returns void language plpgsql security definer set search_path = public as $$
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
end $$;

-- ---------------------------------------------------------------------------
-- Creator actions
-- ---------------------------------------------------------------------------
create or replace function public.start_project(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_x public.campaign_creators;
begin
  select * into v_x from public.campaign_creators where id = p_project and creator_id = v_me for update;
  if not found then raise exception 'Project not found' using errcode = '42501'; end if;
  if v_x.status <> 'hired' then return; end if;
  perform private.set_context(v_me);
  update public.campaign_creators set status = 'in_progress' where id = p_project;
end $$;

-- Returns the open draft (creating the next version if needed)
create or replace function public.create_submission(p_project uuid)
returns uuid language plpgsql security definer set search_path = public as $$
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
end $$;

create or replace function public.submit_submission(p_submission uuid)
returns void language plpgsql security definer set search_path = public as $$
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
end $$;

-- ---------------------------------------------------------------------------
-- Brand review
-- ---------------------------------------------------------------------------
create or replace function public.review_submission(p_submission uuid, p_decision text, p_feedback text default null)
returns void language plpgsql security definer set search_path = public as $$
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
end $$;

create or replace function public.cancel_project(p_project uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
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
end $$;

-- ---------------------------------------------------------------------------
-- Escrow (internal test-mode ledger)
-- ---------------------------------------------------------------------------
create or replace function private.escrow_move(p_e public.escrow_payments, p_to text, p_actor uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
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
end $$;

create or replace function public.fund_escrow(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
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
end $$;

create or replace function private.certificate_code()
returns text language plpgsql volatile as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';   -- 34 symbols, no I/O
  b bytea := extensions.gen_random_bytes(12);
  v text := 'CRT-';
begin
  for i in 0..11 loop
    v := v || substr(alphabet, (get_byte(b, i) % 34) + 1, 1);
    if i in (3, 7) then v := v || '-'; end if;
  end loop;
  return v;
end $$;

-- Final approval: release escrow, complete the project, record earnings, issue the licence record.
create or replace function public.release_escrow(p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
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
end $$;

create or replace function public.refund_escrow(p_project uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
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
end $$;

create or replace function public.dispute_escrow(p_project uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_e public.escrow_payments; v_reason text := nullif(trim(p_reason), '');
begin
  if public.project_role(p_project) not in ('creator', 'brand') then raise exception 'Project not found' using errcode = '42501'; end if;
  if char_length(coalesce(v_reason, '')) < 10 then raise exception 'Describe the problem in a sentence or two' using errcode = '23514'; end if;
  select * into v_e from public.escrow_payments where campaign_creator_id = p_project for update;
  if v_e.id is null or v_e.status <> 'funded' then raise exception 'Only funded escrow can be disputed'; end if;
  perform private.escrow_move(v_e, 'disputed', v_me, v_reason);
end $$;

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------
create or replace function public.mini_profile_json(p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
           'avatar_url', p.avatar_url, 'is_verified', p.is_verified, 'role', p.role,
           'company_name', bd.company_name)
  from public.profiles p left join public.brand_details bd on bd.profile_id = p.id where p.id = p_id;
$$;

create or replace function public.project_summary(p_project uuid)
returns jsonb language sql stable set search_path = public as $$
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
$$;

create or replace function public.submission_json(p_submission uuid)
returns jsonb language sql stable set search_path = public as $$
  select to_jsonb(s) || jsonb_build_object(
    'files', coalesce((select jsonb_agg(to_jsonb(f) order by f.position, f.created_at)
                       from public.submission_files f where f.submission_id = s.id), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('reviewer', public.mini_profile_json(r.reviewer_id)) order by r.created_at)
                         from public.submission_reviews r where r.submission_id = s.id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('author', public.mini_profile_json(m.author_id)) order by m.created_at)
                          from public.submission_comments m where m.submission_id = s.id), '[]'::jsonb))
  from public.submissions s where s.id = p_submission;
$$;

-- Creator: My Projects
create or replace function public.get_my_projects(p_filter text default 'active', p_limit int default 20, p_offset int default 0)
returns table (project jsonb, total_count bigint)
language sql stable set search_path = public as $$
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
$$;

-- Full project for either party (RLS decides what each side sees)
create or replace function public.get_project(p_project uuid)
returns jsonb language sql stable set search_path = public as $$
  select public.project_summary(x.id) || jsonb_build_object(
    'role', public.project_role(x.id),
    'campaign_card', public.campaign_card(x.campaign_id),
    'guideline', (select to_jsonb(g) from public.brand_guidelines g join public.campaigns c on c.guideline_id = g.id where c.id = x.campaign_id),
    'events', coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object('actor', public.mini_profile_json(e.actor_id)) order by e.created_at)
                        from public.project_events e where e.project_id = x.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(pe) order by pe.created_at)
                          from public.payment_events pe join public.escrow_payments e on e.id = pe.escrow_id
                          where e.campaign_creator_id = x.id), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(public.submission_json(s.id) order by s.version desc)
                             from public.submissions s where s.project_id = x.id), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('author', public.mini_profile_json(r.author_id)) order by r.created_at)
                         from public.project_reviews r where r.project_id = x.id), '[]'::jsonb)
  )
  from public.campaign_creators x
  where x.id = p_project and public.project_role(x.id) is not null;
$$;

-- Brand: Creative Review inbox
create or replace function public.get_review_inbox(
  p_campaign uuid default null, p_status text default 'pending', p_creator uuid default null,
  p_limit int default 20, p_offset int default 0)
returns table (item jsonb, total_count bigint)
language sql stable set search_path = public as $$
  select jsonb_build_object(
      'id', s.id, 'version', s.version, 'status', s.status, 'submitted_at', s.submitted_at, 'reviewed_at', s.reviewed_at,
      'project_id', s.project_id, 'project_status', x.status, 'hired', x.hired_at is not null,
      'is_latest', s.version = (select max(version) from public.submissions s2 where s2.project_id = s.project_id and s2.status <> 'draft'),
      'campaign', jsonb_build_object('id', c.id, 'title', c.title, 'is_sprint', c.is_sprint),
      'creator', public.mini_profile_json(s.creator_id),
      'files_count', (select count(*) from public.submission_files f where f.submission_id = s.id),
      'cover', (select jsonb_build_object('media_type', f.media_type, 'preview_path', f.preview_path,
                  'thumbnail_path', f.thumbnail_path, 'preview_kind', f.preview_kind, 'link_url', f.link_url)
                from public.submission_files f where f.submission_id = s.id order by f.position limit 1),
      'ai', (select jsonb_build_object('status', a.status, 'score', a.brand_match_score)
             from public.ai_review_results a where a.submission_id = s.id)),
    count(*) over ()
  from public.submissions s
  join public.campaigns c on c.id = s.campaign_id
  join public.campaign_creators x on x.id = s.project_id
  where c.brand_id = auth.uid() and s.status <> 'draft'
    and (p_campaign is null or s.campaign_id = p_campaign)
    and (p_creator is null or s.creator_id = p_creator)
    and case coalesce(p_status, 'all')
      when 'pending' then s.status = 'submitted'
      when 'all' then true
      else s.status = p_status end
  order by (s.status = 'submitted') desc, s.submitted_at desc nulls last, s.id
  limit greatest(least(p_limit, 50), 1) offset greatest(p_offset, 0);
$$;

-- Brand: one submission in the review workspace
create or replace function public.get_submission_detail(p_submission uuid)
returns jsonb language sql stable set search_path = public as $$
  select public.submission_json(s.id) || jsonb_build_object(
    'creator', public.mini_profile_json(s.creator_id),
    'project', public.project_summary(s.project_id),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status,
                            'submitted_at', v.submitted_at) order by v.version desc)
                          from public.submissions v where v.project_id = s.project_id and v.status <> 'draft'), '[]'::jsonb),
    'ai', (select to_jsonb(a) from public.ai_review_results a where a.submission_id = s.id),
    'campaign', jsonb_build_object('id', c.id, 'title', c.title, 'ai_disclosure_required', c.ai_disclosure_required,
                  'aspect_ratios', c.aspect_ratios, 'is_sprint', c.is_sprint, 'sprint_deadline', c.sprint_deadline,
                  'tools', coalesce((select jsonb_agg(t.name order by t.name) from public.campaign_tools ct
                                     join public.ai_tools t on t.id = ct.tool_id where ct.campaign_id = c.id), '[]'::jsonb),
                  'suggested_tools', to_jsonb(c.suggested_tools)),
    'guideline', (select to_jsonb(g) from public.brand_guidelines g where g.id = c.guideline_id))
  from public.submissions s join public.campaigns c on c.id = s.campaign_id
  where s.id = p_submission and public.can_view_submission(s.id);
$$;

-- Brand: candidates for one campaign or sprint (applicants + projects), with their latest work
create or replace function public.get_hiring_board(p_campaign uuid)
returns table (candidate jsonb)
language sql stable set search_path = public as $$
  with people as (
    select creator_id from public.campaign_applications where campaign_id = p_campaign and status <> 'withdrawn'
    union select creator_id from public.campaign_creators where campaign_id = p_campaign
    union select creator_id from public.campaign_shortlists where campaign_id = p_campaign
  )
  select jsonb_build_object(
    'creator', public.creator_card(p.creator_id),
    'application', (select jsonb_build_object('id', a.id, 'pitch', a.pitch, 'proposed_rate', a.proposed_rate,
                      'status', a.status, 'created_at', a.created_at)
                    from public.campaign_applications a where a.campaign_id = p_campaign and a.creator_id = p.creator_id),
    'shortlisted', exists (select 1 from public.campaign_shortlists s where s.campaign_id = p_campaign and s.creator_id = p.creator_id),
    'project', (select public.project_summary(x.id) from public.campaign_creators x
                where x.campaign_id = p_campaign and x.creator_id = p.creator_id),
    'latest_work', (select jsonb_build_object('submission_id', s.id, 'version', s.version, 'status', s.status,
                      'submitted_at', s.submitted_at,
                      'files', coalesce((select jsonb_agg(jsonb_build_object('media_type', f.media_type, 'preview_path', f.preview_path,
                                          'thumbnail_path', f.thumbnail_path, 'preview_kind', f.preview_kind,
                                          'frame_paths', to_jsonb(f.frame_paths), 'link_url', f.link_url) order by f.position)
                                         from public.submission_files f where f.submission_id = s.id), '[]'::jsonb),
                      'ai_score', (select brand_match_score from public.ai_review_results a where a.submission_id = s.id and a.status = 'done'))
                    from public.submissions s
                    where s.campaign_id = p_campaign and s.creator_id = p.creator_id and s.status <> 'draft'
                    order by s.version desc limit 1))
  from people p
  where public.owns_campaign(p_campaign)
  order by (select case x.status when 'completed' then 6 when 'approved' then 5 when 'submitted' then 4 when 'resubmitted' then 4
                                 when 'in_progress' then 3 when 'hired' then 3 when 'shortlisted' then 2 when 'applied' then 1 else 0 end
            from public.campaign_creators x where x.campaign_id = p_campaign and x.creator_id = p.creator_id) desc nulls last;
$$;

-- Brand: hired projects across campaigns (Active Delivery)
create or replace function public.get_deliveries(p_filter text default 'active', p_limit int default 30, p_offset int default 0)
returns table (project jsonb, total_count bigint)
language sql stable set search_path = public as $$
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
$$;

-- Brand: sprints with live counts
create or replace function public.get_brand_sprints()
returns table (sprint jsonb)
language sql stable set search_path = public as $$
  select jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description, 'status', c.status,
    'budget_min', c.budget_min, 'budget_max', c.budget_max, 'currency', c.currency,
    'sprint_deadline', c.sprint_deadline, 'closed', c.sprint_deadline <= now(), 'created_at', c.created_at,
    'entrants', (select count(*) from public.campaign_applications a where a.campaign_id = c.id and a.status <> 'withdrawn'),
    'submissions', (select count(*) from public.submissions s where s.campaign_id = c.id and s.status <> 'draft'),
    'pending_review', (select count(*) from public.submissions s where s.campaign_id = c.id and s.status = 'submitted'),
    'hired', (select count(*) from public.campaign_creators x where x.campaign_id = c.id and x.hired_at is not null))
  from public.campaigns c
  where c.brand_id = auth.uid() and c.is_sprint
  order by (c.sprint_deadline > now()) desc, c.sprint_deadline desc;
$$;

-- Brand dashboard (Campaigns landing)
create or replace function public.get_brand_overview()
returns jsonb language sql stable set search_path = public as $$
  with mine as (select id, title, status, deadline, is_sprint, sprint_deadline from public.campaigns where brand_id = auth.uid()),
  projects as (select x.* from public.campaign_creators x join mine m on m.id = x.campaign_id),
  activity as (
    (select e.created_at, e.kind, e.event, e.project_id, e.data, e.actor_id, m.title as campaign_title, m.id as campaign_id
     from public.project_events e join projects x on x.id = e.project_id join mine m on m.id = x.campaign_id
     order by e.created_at desc limit 12)
    union all
    (select a.created_at, 'application', 'applied', null, jsonb_build_object('pitch', left(a.pitch, 120)), a.creator_id, m.title, m.id
     from public.campaign_applications a join mine m on m.id = a.campaign_id where a.status <> 'withdrawn'
     order by a.created_at desc limit 12)
  )
  select jsonb_build_object(
    'campaigns', (select count(*) from mine),
    'active_campaigns', (select count(*) from mine where status = 'active'),
    'drafts', (select count(*) from mine where status = 'draft'),
    'creators_hired', (select count(distinct creator_id) from projects where hired_at is not null),
    'active_projects', (select count(*) from projects
                        where status in ('hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved')),
    'pending_reviews', (select count(*) from public.submissions s join mine m on m.id = s.campaign_id where s.status = 'submitted'),
    'awaiting_payment', (select count(*) from projects where status = 'approved'),
    'unread_messages', (select count(*) from public.messages msg
                        join public.conversation_participants me on me.conversation_id = msg.conversation_id and me.user_id = auth.uid()
                        where msg.created_at > me.last_read_at and msg.sender_id <> auth.uid()),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('created_at', a.created_at, 'kind', a.kind, 'event', a.event,
                            'project_id', a.project_id, 'data', a.data, 'campaign_title', a.campaign_title,
                            'campaign_id', a.campaign_id, 'actor', public.mini_profile_json(a.actor_id)) order by a.created_at desc)
                          from (select * from activity order by created_at desc limit 12) a), '[]'::jsonb),
    'deadlines', coalesce((select jsonb_agg(d order by d->>'due_at') from (
        select jsonb_build_object('campaign_id', m.id, 'title', m.title, 'is_sprint', m.is_sprint,
                 'due_at', coalesce(m.sprint_deadline, (m.deadline::timestamp + interval '23 hours 59 minutes') at time zone 'utc'),
                 'open_projects', (select count(*) from projects x where x.campaign_id = m.id
                                   and x.status in ('hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved'))) d
        from mine m
        where m.status = 'active'
          and coalesce(m.sprint_deadline, (m.deadline::timestamp + interval '23 hours 59 minutes') at time zone 'utc') >= now()
        order by coalesce(m.sprint_deadline, m.deadline::timestamptz) limit 6) q), '[]'::jsonb)
  );
$$;

-- Public certificate check: minimal fields only
create or replace function public.verify_certificate(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'certificate_id', i.certificate_id, 'generated_at', i.generated_at,
    'campaign_title', i.terms->>'campaign_title', 'brand', i.terms->>'brand', 'creator', i.terms->>'creator',
    'license_type', i.terms->>'license_type', 'territory', i.terms->>'territory',
    'usage_duration', i.terms->>'usage_duration', 'exclusivity', i.terms->>'exclusivity',
    'asset_count', jsonb_array_length(i.asset_hashes),
    'asset_sha256', coalesce((select jsonb_agg(a->>'sha256') from jsonb_array_elements(i.asset_hashes) a where a->>'sha256' is not null), '[]'::jsonb))
  from public.ip_certificates i
  where i.certificate_id = upper(trim(p_code));
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;

revoke execute on function
  public.hire_creator(uuid, uuid, int, text), public.unhire_creator(uuid, uuid), public.start_project(uuid),
  public.create_submission(uuid), public.submit_submission(uuid), public.review_submission(uuid, text, text),
  public.cancel_project(uuid, text), public.fund_escrow(uuid), public.release_escrow(uuid),
  public.refund_escrow(uuid, text), public.dispute_escrow(uuid, text),
  public.get_my_projects(text, int, int), public.get_project(uuid), public.get_review_inbox(uuid, text, uuid, int, int),
  public.get_submission_detail(uuid), public.get_hiring_board(uuid), public.get_deliveries(text, int, int),
  public.get_brand_sprints(), public.get_brand_overview(), public.project_summary(uuid), public.submission_json(uuid),
  public.mini_profile_json(uuid)
  from public, anon;
grant execute on function
  public.hire_creator(uuid, uuid, int, text), public.unhire_creator(uuid, uuid), public.start_project(uuid),
  public.create_submission(uuid), public.submit_submission(uuid), public.review_submission(uuid, text, text),
  public.cancel_project(uuid, text), public.fund_escrow(uuid), public.release_escrow(uuid),
  public.refund_escrow(uuid, text), public.dispute_escrow(uuid, text),
  public.get_my_projects(text, int, int), public.get_project(uuid), public.get_review_inbox(uuid, text, uuid, int, int),
  public.get_submission_detail(uuid), public.get_hiring_board(uuid), public.get_deliveries(text, int, int),
  public.get_brand_sprints(), public.get_brand_overview(), public.project_summary(uuid), public.submission_json(uuid),
  public.mini_profile_json(uuid)
  to authenticated, service_role;
grant execute on function public.verify_certificate(text) to anon, authenticated, service_role;

-- Trigger functions are never called directly
revoke execute on function public.tg_project_status_event(), public.tg_project_event_fanout(), public.tg_applications_sprint(),
  public.tg_shortlists_project(), public.tg_campaigns_guideline() from public, anon, authenticated;
