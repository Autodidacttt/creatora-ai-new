-- 0023: Accepted offer = agreement → Hire → Fund project; no revisions in offer terms; no Invite; AI Creator Finder.
--
-- Hiring: when one side accepts the other's latest offer, the server records it as an accepted, versioned proposal
-- and the brand can hire straight away (the separate "final proposal" round is gone). A new offer voids the
-- agreement. hire_creator(p_proposal) still needs an accepted proposal and takes the price from it.
-- Funding: a hire starts as 'awaiting_funding'. Until the brand funds the demo escrow the creator can't start,
-- submit or get tasks, isn't a collaborator and isn't in the group chat. Funding moves the project to in_progress.
-- Offer terms no longer carry "revisions" (the review flow's "Request revision" is untouched). Invites are removed.
-- AI Creator Finder: creator embeddings (pgvector), persisted searches/results, cached "why" reasons.
-- Rollout: this file only adds or replaces and is safe with the previous app (0022 era) still serving. The old
-- "final proposal" RPCs become stubs that ask for a refresh, so the old UI can't create states it can't render.
-- 0024 removes the legacy RPCs and moves unfunded hires to awaiting_funding once the new app is live.

-- ---------------------------------------------------------------------------
-- 1. Project status: awaiting_funding
-- ---------------------------------------------------------------------------
alter table public.campaign_creators drop constraint campaign_creators_status_check;
alter table public.campaign_creators add constraint campaign_creators_status_check check (status = any (array[
  'applied', 'shortlisted', 'awaiting_funding', 'hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted',
  'approved', 'completed', 'rejected', 'cancelled']));
alter table public.campaign_creators drop constraint campaign_creators_hired_check;
alter table public.campaign_creators add constraint campaign_creators_hired_check check (
  status <> all (array['awaiting_funding', 'hired', 'in_progress', 'approved', 'completed']) or hired_at is not null);

create or replace function public.project_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('applied', 'shortlisted'), ('applied', 'hired'), ('applied', 'awaiting_funding'), ('applied', 'submitted'), ('applied', 'rejected'), ('applied', 'cancelled'),
    ('shortlisted', 'applied'), ('shortlisted', 'hired'), ('shortlisted', 'awaiting_funding'), ('shortlisted', 'submitted'), ('shortlisted', 'rejected'), ('shortlisted', 'cancelled'),
    ('awaiting_funding', 'in_progress'), ('awaiting_funding', 'cancelled'),
    ('hired', 'awaiting_funding'), ('hired', 'in_progress'), ('hired', 'submitted'), ('hired', 'cancelled'),
    ('in_progress', 'submitted'), ('in_progress', 'cancelled'),
    ('submitted', 'revision_requested'), ('submitted', 'approved'), ('submitted', 'rejected'), ('submitted', 'cancelled'),
    ('revision_requested', 'resubmitted'), ('revision_requested', 'rejected'), ('revision_requested', 'cancelled'),
    ('resubmitted', 'submitted'), ('resubmitted', 'revision_requested'), ('resubmitted', 'approved'),
    ('resubmitted', 'rejected'), ('resubmitted', 'cancelled'),
    ('approved', 'completed')
  );
$$;

create or replace function private.event_text(p_kind text, p_event text, p_title text, p_note text, p_data jsonb)
returns text language sql immutable as $$
  select left(case p_kind
    when 'payment' then case p_event
      when 'funded' then format('Escrow funded for “%s”: %s. Demo — no real money moved.', p_title, p_data->>'amount_label')
      when 'released' then format('Payment released for “%s”: %s. Demo — no real money moved.', p_title, p_data->>'amount_label')
      when 'refunded' then format('Escrow refunded for “%s”.%s', p_title, coalesce(' Reason: ' || p_note, ''))
      when 'disputed' then format('Payment for “%s” is disputed.%s', p_title, coalesce(' Reason: ' || p_note, ''))
      else format('Payment update on “%s”.', p_title) end
    when 'certificate' then format('Commercial licence record %s issued for “%s”.', p_data->>'certificate_id', p_title)
    else case p_event
      when 'applied' then format('Applied to “%s”.', p_title)
      when 'shortlisted' then format('Shortlisted for “%s”.', p_title)
      when 'awaiting_funding' then format('Hired for “%s”%s. Waiting for the brand to fund the project (demo escrow) before work starts.',
                                          p_title, coalesce(' at ' || (p_data->>'amount_label'), ''))
      when 'hired' then format('Hired for “%s”%s.', p_title, coalesce(' at ' || (p_data->>'amount_label'), ''))
      when 'in_progress' then case when p_data->>'funded' = 'true'
                                then format('The project “%s” is funded — work can start.', p_title)
                                else format('Work started on “%s”.', p_title) end
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

-- Funding the escrow is what starts the project
create or replace function public.fund_escrow(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_x public.campaign_creators; v_e public.escrow_payments;
begin
  select x.* into v_x from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
  where x.id = p_project and c.brand_id = v_me for update of x;
  if not found then raise exception 'Project not found' using errcode = '42501'; end if;
  if v_x.status in ('rejected', 'cancelled', 'completed') then raise exception 'This project is %', v_x.status; end if;
  select * into v_e from public.escrow_payments where campaign_creator_id = p_project for update;
  if v_e.id is null then raise exception 'Hire the creator first to set an amount' using errcode = '23514'; end if;
  if v_e.status <> 'unfunded' then raise exception 'Escrow is already %', v_e.status; end if;
  perform private.escrow_move(v_e, 'funded', v_me, 'Funded by the brand (demo — no real money)');
  if v_x.status in ('awaiting_funding', 'hired') then
    perform private.set_context(v_me, null, jsonb_build_object('funded', true, 'amount_label', private.money(v_e.amount, v_e.currency)));
    update public.campaign_creators set status = 'in_progress' where id = p_project;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Collaborators = hired AND funded (awaiting_funding hires are not in groups, counts or tasks)
-- ---------------------------------------------------------------------------
create or replace function public.is_campaign_collaborator(p_campaign uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campaign_creators x where x.campaign_id = p_campaign and x.creator_id = p_user
                 and x.hired_at is not null and x.status not in ('cancelled', 'rejected', 'awaiting_funding'));
$$;

create or replace view public.campaign_stats with (security_invoker = true) as
select c.id as campaign_id,
  (select count(*) from public.campaign_applications a where a.campaign_id = c.id and a.status <> 'withdrawn')::int as applications_count,
  (select count(*) from public.campaign_shortlists s where s.campaign_id = c.id)::int as shortlisted_count,
  (select count(*) from public.campaign_creators x where x.campaign_id = c.id and x.hired_at is not null
     and x.status not in ('cancelled', 'rejected', 'awaiting_funding'))::int as selected_count
from public.campaigns c;

create or replace function private.sync_campaign_group(p_campaign uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_c public.campaigns; v_conv uuid; v_n int; r record;
begin
  perform pg_advisory_xact_lock(hashtext('group:' || p_campaign::text));
  select * into v_c from public.campaigns where id = p_campaign;
  if v_c.id is null then return null; end if;
  select count(*) into v_n from public.campaign_creators x
  where x.campaign_id = p_campaign and x.hired_at is not null and x.status not in ('cancelled', 'rejected', 'awaiting_funding');
  select id into v_conv from public.conversations where campaign_id = p_campaign and type = 'group';
  if v_conv is null then
    if v_n < 2 then return null; end if;
    insert into public.conversations (type, campaign_id) values ('group', p_campaign) returning id into v_conv;
    insert into public.conversation_participants (conversation_id, user_id) values (v_conv, v_c.brand_id) on conflict do nothing;
    perform private.post_message(v_conv, v_c.brand_id, 'system',
      format('Group chat for “%s” — the brand and every funded collaborator. Group tasks are posted here.', v_c.title));
  end if;
  for r in select x.creator_id, p.display_name from public.campaign_creators x join public.profiles p on p.id = x.creator_id
           where x.campaign_id = p_campaign and x.hired_at is not null and x.status not in ('cancelled', 'rejected', 'awaiting_funding')
             and not exists (select 1 from public.conversation_participants cp where cp.conversation_id = v_conv and cp.user_id = x.creator_id)
           order by x.hired_at loop
    insert into public.conversation_participants (conversation_id, user_id) values (v_conv, r.creator_id);
    perform private.post_message(v_conv, v_c.brand_id, 'system', format('%s joined the group.', r.display_name));
  end loop;
  for r in select cp.user_id, p.display_name from public.conversation_participants cp join public.profiles p on p.id = cp.user_id
           where cp.conversation_id = v_conv and cp.user_id <> v_c.brand_id
             and not public.is_campaign_collaborator(p_campaign, cp.user_id) loop
    delete from public.conversation_participants where conversation_id = v_conv and user_id = r.user_id;
    perform private.post_message(v_conv, v_c.brand_id, 'system', format('%s left the group.', r.display_name));
  end loop;
  return v_conv;
end $$;

create or replace function public.create_campaign_task(p_campaign uuid, p_title text, p_description text default null,
  p_due_date date default null, p_assignee uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := private.assert_active();
  v_c public.campaigns;
  v_t public.campaign_tasks;
  v_group uuid;
  v_label text;
  r record;
begin
  select * into v_c from public.campaigns where id = p_campaign;
  if v_c.id is null or v_c.brand_id <> v_me then raise exception 'Only the brand can assign tasks' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Give the task a title' using errcode = '23514'; end if;
  if p_assignee is not null and not public.is_campaign_collaborator(p_campaign, p_assignee) then
    if exists (select 1 from public.campaign_creators where campaign_id = p_campaign and creator_id = p_assignee and status = 'awaiting_funding') then
      raise exception 'Fund this hire first — tasks start once the project is funded' using errcode = '23514';
    end if;
    raise exception 'Tasks can only be assigned to creators hired for this brief' using errcode = '23514';
  end if;
  if p_assignee is null and not exists (select 1 from public.campaign_creators x where x.campaign_id = p_campaign
                                        and public.is_campaign_collaborator(p_campaign, x.creator_id)) then
    raise exception 'Hire and fund a creator before assigning group tasks' using errcode = '23514';
  end if;
  insert into public.campaign_tasks (campaign_id, title, description, due_date, scope, assigned_to, created_by)
  values (p_campaign, trim(p_title), nullif(trim(p_description), ''), p_due_date,
          case when p_assignee is null then 'group' else 'individual' end, p_assignee, v_me)
  returning * into v_t;
  v_label := format('New task: %s%s', v_t.title, coalesce(' · due ' || to_char(v_t.due_date, 'Mon DD, YYYY'), ''));

  if v_t.scope = 'individual' then
    perform private.post_message(private.ensure_campaign_dm(p_campaign, v_me, p_assignee), v_me, 'task', v_label,
      jsonb_build_object('task_id', v_t.id, 'title', v_t.title, 'due_date', v_t.due_date, 'scope', v_t.scope));
  else
    v_group := (select id from public.conversations where campaign_id = p_campaign and type = 'group');
    if v_group is not null then
      perform private.post_message(v_group, v_me, 'task', v_label || ' (for everyone)',
        jsonb_build_object('task_id', v_t.id, 'title', v_t.title, 'due_date', v_t.due_date, 'scope', v_t.scope));
    end if;
  end if;
  for r in select x.id as project_id, x.creator_id from public.campaign_creators x
           where x.campaign_id = p_campaign and public.is_campaign_collaborator(p_campaign, x.creator_id)
             and (p_assignee is null or x.creator_id = p_assignee) loop
    if v_t.scope = 'group' and v_group is null then
      perform private.post_message(private.ensure_campaign_dm(p_campaign, v_me, r.creator_id), v_me, 'task', v_label || ' (for everyone)',
        jsonb_build_object('task_id', v_t.id, 'title', v_t.title, 'due_date', v_t.due_date, 'scope', v_t.scope));
    end if;
    perform public.notify(r.creator_id, v_me, 'task', 'project', r.project_id,
      jsonb_build_object('event', 'task_assigned', 'task_id', v_t.id, 'title', v_t.title, 'campaign_title', v_c.title,
                         'scope', v_t.scope, 'due_date', v_t.due_date));
  end loop;
  return v_t.id;
end $$;

-- Belt and braces: no submission row for a project that isn't funded yet (create_submission already refuses)
create or replace function public.tg_submissions_require_funding()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.campaign_creators where id = new.project_id and status = 'awaiting_funding') then
    raise exception 'The brand hasn''t funded this project yet — work starts once it''s funded' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger submissions_require_funding before insert on public.submissions
  for each row execute function public.tg_submissions_require_funding();

-- ---------------------------------------------------------------------------
-- 3. Offer terms without revisions; accepting an offer is the agreement
-- ---------------------------------------------------------------------------
create or replace function private.clean_terms(p_terms jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v_t jsonb := coalesce(p_terms, '{}'::jsonb);
  v_deliv text := nullif(trim(v_t->>'deliverables'), '');
  v_deadline date;
  v_rights text[];
begin
  if jsonb_typeof(v_t) <> 'object' then raise exception 'Invalid terms' using errcode = '22023'; end if;
  if v_deliv is null then raise exception 'Describe the deliverables' using errcode = '23514'; end if;
  if char_length(v_deliv) > 1000 then raise exception 'Deliverables are too long (1000 characters max)' using errcode = '23514'; end if;
  begin
    v_deadline := nullif(v_t->>'deadline', '')::date;
  exception when others then
    raise exception 'Invalid deadline' using errcode = '22023';
  end;
  if jsonb_typeof(coalesce(v_t->'usage_rights', '[]'::jsonb)) <> 'array' then raise exception 'Invalid usage rights' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_rights from jsonb_array_elements_text(coalesce(v_t->'usage_rights', '[]'::jsonb)) x;
  if not (v_rights <@ array['organic_social', 'paid_social', 'broadcast', 'ooh', 'web', 'internal']) then
    raise exception 'Unknown usage right' using errcode = '23514';
  end if;
  return jsonb_build_object('deliverables', v_deliv, 'deadline', v_deadline, 'usage_rights', to_jsonb(v_rights));
end $$;

create or replace function private.terms_label(p_price int, p_currency text, p_terms jsonb)
returns text language sql immutable as $$
  select private.money(p_price, p_currency)
    || coalesce(' · due ' || to_char((p_terms->>'deadline')::date, 'Mon DD, YYYY'), '')
    || ' · ' || left(coalesce(p_terms->>'deliverables', ''), 120);
$$;

create or replace function public.send_offer(p_conversation uuid, p_price int, p_terms jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := private.assert_active();
  v_p record;
  v_terms jsonb;
  v_id uuid;
  v_voided boolean := false;
  r record;
begin
  select * into v_p from private.negotiation_parties(p_conversation, v_me);
  if (v_p.campaign).status = 'completed' then raise exception 'This brief is already completed' using errcode = '23514'; end if;
  if v_p.creator_id is null then raise exception 'Negotiation not found' using errcode = '42501'; end if;
  if private.is_hired((v_p.campaign).id, v_p.creator_id) then
    raise exception 'This creator is already hired for this brief' using errcode = '23514';
  end if;
  if p_price is null or p_price < 1 or p_price > 10000000 then
    raise exception 'Enter a price greater than zero' using errcode = '23514';
  end if;
  v_terms := private.clean_terms(p_terms);

  update public.messages set payload = payload || '{"status": "countered"}'::jsonb
  where conversation_id = p_conversation and kind = 'offer' and payload->>'status' in ('open', 'accepted');
  -- A new offer voids any agreement that wasn't hired yet
  for r in select id from public.proposals
           where campaign_id = (v_p.campaign).id and creator_id = v_p.creator_id and status in ('draft', 'sent', 'accepted') loop
    perform private.set_proposal_status(r.id, 'superseded');
    v_voided := true;
  end loop;
  if v_voided then
    perform private.post_message(p_conversation, v_me, 'system', 'New offer — the previous agreement is void until both sides accept again.');
  end if;

  v_id := private.post_message(p_conversation, v_me, 'offer',
    'Offer: ' || private.terms_label(p_price, (v_p.campaign).currency, v_terms),
    jsonb_build_object('price', p_price, 'currency', (v_p.campaign).currency, 'terms', v_terms, 'status', 'open',
                       'by', case when v_me = v_p.brand_id then 'brand' else 'creator' end));
  perform public.notify(case when v_me = v_p.brand_id then v_p.creator_id else v_p.brand_id end, v_me, 'proposal',
    'conversation', p_conversation, jsonb_build_object('event', 'offer', 'campaign_id', (v_p.campaign).id,
      'campaign_title', (v_p.campaign).title, 'amount_label', private.money(p_price, (v_p.campaign).currency)));
  return v_id;
end $$;

-- Accepting the other side's latest offer is the final agreement: it is recorded as an accepted, versioned proposal
-- that the brand hires from right away. Returns the proposal id.
drop function public.accept_offer(uuid);
create function public.accept_offer(p_message uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_m public.messages; v_p record; v_version int; v_id uuid; v_price int; v_cur text; r record;
begin
  select * into v_m from public.messages where id = p_message and kind = 'offer' for update;
  if v_m.id is null then raise exception 'Offer not found' using errcode = '42501'; end if;
  select * into v_p from private.negotiation_parties(v_m.conversation_id, v_me);
  if v_m.sender_id = v_me then raise exception 'The other side has to accept your offer' using errcode = '23514'; end if;
  if v_m.payload->>'status' <> 'open' then raise exception 'This offer is no longer open' using errcode = '23514'; end if;
  if exists (select 1 from public.messages where conversation_id = v_m.conversation_id and kind = 'offer' and created_at > v_m.created_at) then
    raise exception 'A newer offer replaced this one' using errcode = '23514';
  end if;
  if private.is_hired((v_p.campaign).id, v_p.creator_id) then
    raise exception 'This creator is already hired for this brief' using errcode = '23514';
  end if;
  v_price := (v_m.payload->>'price')::int;
  v_cur := v_m.payload->>'currency';
  update public.messages set payload = payload || jsonb_build_object('status', 'accepted', 'accepted_by', v_me, 'accepted_at', now())
  where id = p_message;

  for r in select id from public.proposals
           where campaign_id = (v_p.campaign).id and creator_id = v_p.creator_id and status in ('draft', 'sent', 'accepted') loop
    perform private.set_proposal_status(r.id, 'superseded');
  end loop;
  perform pg_advisory_xact_lock(hashtext('proposal:' || (v_p.campaign).id::text || v_p.creator_id::text));
  select coalesce(max(version), 0) + 1 into v_version from public.proposals
  where campaign_id = (v_p.campaign).id and creator_id = v_p.creator_id;
  insert into public.proposals (campaign_id, creator_id, conversation_id, version, price, currency, terms, status, sent_at, decided_at)
  values ((v_p.campaign).id, v_p.creator_id, v_m.conversation_id, v_version, v_price, v_cur,
          private.clean_terms(v_m.payload->'terms') || jsonb_build_object('offer_message_id', v_m.id), 'accepted', now(), now())
  returning id into v_id;

  perform private.post_message(v_m.conversation_id, v_me, 'system',
    format('Terms agreed (v%s): %s. The brand can hire now.', v_version, private.terms_label(v_price, v_cur, v_m.payload->'terms')));
  perform public.notify(v_m.sender_id, v_me, 'proposal', 'conversation', v_m.conversation_id,
    jsonb_build_object('event', case when v_m.sender_id = v_p.brand_id then 'offer_accepted_hire' else 'offer_accepted' end,
                       'campaign_id', (v_p.campaign).id, 'campaign_title', (v_p.campaign).title,
                       'amount_label', private.money(v_price, v_cur), 'proposal_id', v_id));
  return v_id;
end $$;

-- The "final proposal" round is gone. Stubs keep the previous app's buttons answering until 0024 drops them.
create or replace function public.send_final_proposal(p_conversation uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Hiring was updated: accepting an offer is now the agreement. Refresh the page to hire.' using errcode = '23514';
end $$;
create or replace function public.reject_proposal(p_proposal uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Hiring was updated: send a new offer to change the terms. Refresh the page.' using errcode = '23514';
end $$;
create or replace function private.do_hire(p_actor uuid, p_campaign uuid, p_creator uuid, p_amount integer, p_currency text)
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

-- ---------------------------------------------------------------------------
-- 4. Read models: awaiting_funding projects are open (listed, counted as open), just not started
-- ---------------------------------------------------------------------------
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
      when 'active' then x.status in ('awaiting_funding', 'hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved')
                      or (c.is_sprint and x.status in ('applied', 'shortlisted'))
      when 'completed' then x.status = 'completed'
      when 'closed' then x.status in ('rejected', 'cancelled')
      else true end
  order by (x.status = 'revision_requested') desc, x.status_changed_at desc, x.id
  limit greatest(least(p_limit, 50), 1) offset greatest(p_offset, 0);
$function$
;

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
      when 'active' then x.status in ('awaiting_funding', 'hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved')
      when 'completed' then x.status = 'completed'
      when 'closed' then x.status in ('rejected', 'cancelled')
      else true end
  order by (x.status = 'approved') desc, x.status_changed_at desc, x.id
  limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0);
$function$
;

CREATE OR REPLACE FUNCTION public.get_brand_overview()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
                        where status in ('awaiting_funding', 'hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved')),
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
                                   and x.status in ('awaiting_funding', 'hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved'))) d
        from mine m
        where m.status = 'active'
          and coalesce(m.sprint_deadline, (m.deadline::timestamp + interval '23 hours 59 minutes') at time zone 'utc') >= now()
        order by coalesce(m.sprint_deadline, m.deadline::timestamptz) limit 6) q), '[]'::jsonb)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.get_creator_dashboard()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'applications', (select count(*) from public.campaign_applications
                     where creator_id = auth.uid() and status <> 'withdrawn'),
    'shortlisted', (select count(*) from public.campaign_shortlists where creator_id = auth.uid()),
    'selected', (select count(*) from public.campaign_creators where creator_id = auth.uid() and hired_at is not null),
    'active_projects', (select count(*) from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
                        where x.creator_id = auth.uid()
                          and (x.status in ('awaiting_funding', 'hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved')
                               or (c.is_sprint and x.status in ('applied', 'shortlisted') and c.sprint_deadline > now()))),
    'revisions_requested', (select count(*) from public.campaign_creators where creator_id = auth.uid() and status = 'revision_requested'),
    'saved_opportunities', (select count(*) from public.saved_opportunities where creator_id = auth.uid()),
    'profile_views', (select count(*) from public.interactions
                      where target_type = 'profile' and target_id = auth.uid() and action = 'view'),
    'brand_interest', (select count(distinct i.user_id) from public.interactions i
                       join public.profiles p on p.id = i.user_id and p.role = 'brand'
                       where i.target_type = 'profile' and i.target_id = auth.uid()
                         and i.action in ('swipe_right', 'contact', 'shortlist')));
$function$
;

CREATE OR REPLACE FUNCTION public.get_hiring_board(p_campaign uuid)
 RETURNS TABLE(candidate jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
                                 when 'in_progress' then 3 when 'hired' then 3 when 'awaiting_funding' then 3 when 'shortlisted' then 2 when 'applied' then 1 else 0 end
            from public.campaign_creators x where x.campaign_id = p_campaign and x.creator_id = p.creator_id) desc nulls last;
$function$
;


-- ---------------------------------------------------------------------------
-- 5. Hire from the accepted agreement → awaiting funding
-- ---------------------------------------------------------------------------
create or replace function public.hire_creator(p_proposal uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_pr public.proposals; v_c public.campaigns; v_project uuid;
begin
  select * into v_pr from public.proposals where id = p_proposal for update;
  select * into v_c from public.campaigns where id = v_pr.campaign_id;
  if v_pr.id is null or v_c.brand_id is distinct from v_me then
    raise exception 'Only the brand that owns this brief can hire' using errcode = '42501';
  end if;
  if v_pr.status <> 'accepted' then
    raise exception 'Hire needs terms both sides accepted (this agreement is %)', v_pr.status using errcode = '23514';
  end if;
  if exists (select 1 from public.proposals where campaign_id = v_pr.campaign_id and creator_id = v_pr.creator_id and version > v_pr.version) then
    raise exception 'A newer agreement replaced this one' using errcode = '23514';
  end if;
  if private.is_hired(v_pr.campaign_id, v_pr.creator_id) then
    raise exception 'This creator is already hired for this brief' using errcode = '23514';
  end if;
  v_project := private.do_hire(v_me, v_pr.campaign_id, v_pr.creator_id, v_pr.price, v_pr.currency);
  update public.proposals set decided_at = now() where id = p_proposal;
  if v_pr.conversation_id is not null then
    perform private.post_message(v_pr.conversation_id, v_me, 'system',
      format('Hired at %s (agreement v%s). Next: the brand funds the project (demo escrow) and work can start.',
             private.money(v_pr.price, v_pr.currency), v_pr.version));
  end if;
  -- The brand's to-do: fund it (the creator is told by the awaiting_funding project event)
  perform public.notify(v_me, null, 'project', 'project', v_project,
    jsonb_build_object('event', 'funding_required', 'campaign_id', v_c.id, 'campaign_title', v_c.title,
                       'amount_label', private.money(v_pr.price, v_pr.currency)));
  return v_project;
end $$;

create or replace function public.unhire_creator(p_campaign uuid, p_creator uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_x public.campaign_creators; r record;
begin
  select x.* into v_x from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
  where x.campaign_id = p_campaign and x.creator_id = p_creator and c.brand_id = v_me;
  if not found then raise exception 'Project not found' using errcode = '42501'; end if;
  if v_x.status not in ('awaiting_funding', 'hired', 'applied', 'shortlisted')
     or exists (select 1 from public.submissions where project_id = v_x.id and status <> 'draft')
     or exists (select 1 from public.escrow_payments where campaign_creator_id = v_x.id and status <> 'unfunded') then
    raise exception 'Work or payment has started on this project — cancel it instead' using errcode = '23514';
  end if;
  delete from public.campaign_creators where id = v_x.id;
  for r in select id from public.proposals where campaign_id = p_campaign and creator_id = p_creator and status = 'accepted' loop
    perform private.set_proposal_status(r.id, 'superseded');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Negotiation card / collaborators / pipeline
-- ---------------------------------------------------------------------------
create or replace function public.get_negotiation(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_conv public.conversations; v_c public.campaigns; v_creator uuid; v_offer public.messages; v_pr public.proposals;
        v_x public.campaign_creators; v_app public.campaign_applications; v_state text; v_escrow text;
begin
  select * into v_conv from public.conversations where id = p_conversation;
  if v_conv.id is null or v_conv.type <> 'direct' or v_conv.campaign_id is null or not public.is_participant(p_conversation) then
    return null;
  end if;
  select * into v_c from public.campaigns where id = v_conv.campaign_id;
  select user_id into v_creator from public.conversation_participants where conversation_id = p_conversation and user_id <> v_c.brand_id limit 1;
  select * into v_offer from public.messages where conversation_id = p_conversation and kind = 'offer' order by created_at desc limit 1;
  select * into v_pr from public.proposals where campaign_id = v_c.id and creator_id = v_creator order by version desc limit 1;
  select * into v_x from public.campaign_creators where campaign_id = v_c.id and creator_id = v_creator;
  select * into v_app from public.campaign_applications where campaign_id = v_c.id and creator_id = v_creator;
  select status into v_escrow from public.escrow_payments where campaign_creator_id = v_x.id;
  v_state := case
    when private.is_hired(v_c.id, v_creator) and v_x.status = 'awaiting_funding' then 'awaiting_funding'
    when private.is_hired(v_c.id, v_creator) then 'hired'
    when v_pr.status = 'accepted' then 'agreed'
    when v_offer.id is not null then 'negotiating'
    else 'open' end;
  return jsonb_build_object(
    'state', v_state, 'brand_id', v_c.brand_id, 'creator_id', v_creator,
    'campaign', jsonb_build_object('id', v_c.id, 'title', v_c.title, 'status', v_c.status, 'description', left(v_c.description, 280),
      'deliverables', v_c.deliverables, 'budget_min', v_c.budget_min, 'budget_max', v_c.budget_max, 'currency', v_c.currency,
      'deadline', v_c.deadline, 'usage_rights', to_jsonb(v_c.usage_rights), 'creators_needed', v_c.creators_needed, 'is_sprint', v_c.is_sprint),
    'application', case when v_app.id is not null then jsonb_build_object('proposed_rate', v_app.proposed_rate, 'status', v_app.status) end,
    'latest_offer', case when v_offer.id is not null then v_offer.payload || jsonb_build_object('message_id', v_offer.id, 'sender_id', v_offer.sender_id) end,
    'proposal', case when v_pr.id is not null then jsonb_build_object('id', v_pr.id, 'version', v_pr.version, 'status', v_pr.status,
      'price', v_pr.price, 'currency', v_pr.currency, 'terms', v_pr.terms, 'note', v_pr.note, 'sent_at', v_pr.sent_at) end,
    'project', case when v_x.id is not null and v_x.hired_at is not null then
      jsonb_build_object('id', v_x.id, 'status', v_x.status, 'escrow_status', v_escrow) end);
end $$;

create or replace function public.get_campaign_collaborators(p_campaign uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'campaign', jsonb_build_object('id', c.id, 'title', c.title, 'status', c.status, 'creators_needed', c.creators_needed),
    'count', (select count(*) from public.campaign_creators x where x.campaign_id = c.id and x.hired_at is not null
              and x.status not in ('cancelled', 'rejected', 'awaiting_funding')),
    'group_conversation_id', (select g.id from public.conversations g where g.campaign_id = c.id and g.type = 'group'
                              and public.is_participant(g.id)),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'creator', public.mini_profile_json(x.creator_id), 'project_id', x.id, 'status', x.status, 'hired_at', x.hired_at,
        'agreed_amount', case when c.brand_id = auth.uid() then x.agreed_amount end, 'currency', x.currency,
        'conversation_id', case when c.brand_id = auth.uid() then
          (select d.id from public.conversations d where d.dm_key = private.campaign_dm_key(c.id, c.brand_id, x.creator_id)) end)
        order by x.hired_at)
      from public.campaign_creators x where x.campaign_id = c.id and x.hired_at is not null
        and x.status not in ('cancelled', 'rejected', 'awaiting_funding')), '[]'::jsonb),
    -- Hired but not funded yet (brand only): not collaborators until the project is funded
    'awaiting_funding', case when c.brand_id = auth.uid() then coalesce((select jsonb_agg(jsonb_build_object(
        'creator', public.mini_profile_json(x.creator_id), 'project_id', x.id, 'hired_at', x.hired_at,
        'agreed_amount', x.agreed_amount, 'currency', x.currency) order by x.hired_at)
      from public.campaign_creators x where x.campaign_id = c.id and x.status = 'awaiting_funding'), '[]'::jsonb) else '[]'::jsonb end,
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('assignee', case when t.assigned_to is not null
                                          then public.mini_profile_json(t.assigned_to) end) order by t.status = 'done', t.due_date nulls last, t.created_at desc)
      from public.campaign_tasks t where t.campaign_id = c.id
        and (c.brand_id = auth.uid() or t.scope = 'group' or t.assigned_to = auth.uid())), '[]'::jsonb))
  from public.campaigns c
  where c.id = p_campaign and (c.brand_id = auth.uid() or public.is_campaign_collaborator(c.id, auth.uid()) or public.is_admin());
$$;

create or replace function public.get_campaign_pipeline(p_campaign uuid)
returns table(creator jsonb, stage text, note text, created_at timestamptz, applied boolean, added_while_draft boolean)
language sql stable set search_path = public as $$
  select public.creator_card(s.creator_id), 'shortlisted', s.note, s.created_at,
         exists (select 1 from public.campaign_applications a where a.campaign_id = s.campaign_id
                 and a.creator_id = s.creator_id and a.status <> 'withdrawn'),
         s.added_while_draft
  from public.campaign_shortlists s where s.campaign_id = p_campaign
  union all
  select public.creator_card(x.creator_id),
         case when x.status = 'completed' then 'completed' when x.status = 'awaiting_funding' then 'awaiting_funding' else 'selected' end,
         null, coalesce(x.hired_at, x.created_at),
         exists (select 1 from public.campaign_applications a where a.campaign_id = x.campaign_id
                 and a.creator_id = x.creator_id and a.status <> 'withdrawn'),
         false
  from public.campaign_creators x
  where x.campaign_id = p_campaign and x.hired_at is not null and x.status not in ('cancelled', 'rejected')
  order by 4 desc;
$$;

-- ---------------------------------------------------------------------------
-- 7. Invites are removed (Message / Shortlist replace them): the app no longer calls invite_creator; 0024 drops it
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 8. Backfill: existing agreements follow the new rules (terms and unfunded hires: 0024)
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  -- A final proposal that was waiting for the brand is now simply the accepted agreement: the brand can hire.
  -- Older agreements of a pair that isn't hired step aside first (one accepted agreement per pair).
  for r in select p.id, p.campaign_id, p.creator_id from public.proposals p where p.status = 'sent' loop
    update public.proposals set status = 'superseded'
    where campaign_id = r.campaign_id and creator_id = r.creator_id and status = 'accepted' and id <> r.id
      and not private.is_hired(r.campaign_id, r.creator_id);
    if not private.is_hired(r.campaign_id, r.creator_id) then
      perform private.set_proposal_status(r.id, 'accepted');
    else
      perform private.set_proposal_status(r.id, 'superseded');
    end if;
  end loop;
  -- Terms both sides accepted but never sent as a proposal: record the agreement
  for r in select c.id as conv, c.campaign_id, cp.user_id as creator_id, m.id as msg, m.payload, m.created_at
           from public.conversations c
           join public.campaigns k on k.id = c.campaign_id
           join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id <> k.brand_id
           join lateral (select * from public.messages x where x.conversation_id = c.id and x.kind = 'offer'
                         order by x.created_at desc limit 1) m on true
           where c.type = 'direct' and c.campaign_id is not null and m.payload->>'status' = 'accepted'
             and not private.is_hired(c.campaign_id, cp.user_id)
             and not exists (select 1 from public.proposals p where p.campaign_id = c.campaign_id and p.creator_id = cp.user_id and p.status = 'accepted') loop
    insert into public.proposals (campaign_id, creator_id, conversation_id, version, price, currency, terms, status, sent_at, decided_at, created_at)
    values (r.campaign_id, r.creator_id, r.conv,
            coalesce((select max(version) from public.proposals where campaign_id = r.campaign_id and creator_id = r.creator_id), 0) + 1,
            (r.payload->>'price')::int, r.payload->>'currency',
            (r.payload->'terms') - 'revisions' || jsonb_build_object('offer_message_id', r.msg), 'accepted', r.created_at, now(), r.created_at);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. AI Creator Finder: creator embeddings (server-only)
-- ---------------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- One vector per creator, built from profile, specializations, tools, skills, styles and portfolio metadata.
-- Never exposed to clients (no grants for anon/authenticated; RLS on with no policies).
create table public.creator_embeddings (
  creator_id uuid primary key references public.profiles(id) on delete cascade,
  embedding extensions.vector(768),
  model text,
  source_hash text,
  stale boolean not null default true,
  marked_at timestamptz not null default now(),
  embedded_at timestamptz
);
create index creator_embeddings_stale_idx on public.creator_embeddings(marked_at) where stale;
alter table public.creator_embeddings enable row level security;
revoke all on public.creator_embeddings from anon, authenticated;
grant all on public.creator_embeddings to service_role;

create or replace function private.mark_creator_stale(p_creator uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.creator_embeddings (creator_id, stale, marked_at)
  select p_creator, true, now() where exists (select 1 from public.profiles where id = p_creator and role = 'creator')
  on conflict (creator_id) do update set stale = true, marked_at = now();
$$;

-- Profile / attribute / portfolio changes queue the creator for re-embedding (the server job picks them up)
create or replace function public.tg_creator_embedding_stale()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_creator uuid;
begin
  -- One trigger function for several tables: read the row as JSON so no table-specific column is referenced
  v_creator := case tg_table_name
    when 'profiles' then (v_row->>'id')::uuid
    when 'creator_details' then (v_row->>'profile_id')::uuid
    when 'post_tools' then (select creator_id from public.posts where id = (v_row->>'post_id')::uuid)
    else (v_row->>'creator_id')::uuid end;
  if v_creator is not null then perform private.mark_creator_stale(v_creator); end if;
  return null;
end $$;
create trigger profiles_embedding_stale after update of display_name, headline, bio, location on public.profiles
  for each row when (new.role = 'creator') execute function public.tg_creator_embedding_stale();
create trigger creator_details_embedding_stale after insert or update on public.creator_details
  for each row execute function public.tg_creator_embedding_stale();
create trigger posts_embedding_stale after insert or delete or update of title, description, content_type_id, style_id, category_id, workflow_notes, is_removed on public.posts
  for each row execute function public.tg_creator_embedding_stale();
create trigger post_tools_embedding_stale after insert or delete on public.post_tools
  for each row execute function public.tg_creator_embedding_stale();
create trigger creator_tools_embedding_stale after insert or delete on public.creator_tools for each row execute function public.tg_creator_embedding_stale();
create trigger creator_skills_embedding_stale after insert or delete on public.creator_skills for each row execute function public.tg_creator_embedding_stale();
create trigger creator_categories_embedding_stale after insert or delete on public.creator_categories for each row execute function public.tg_creator_embedding_stale();
create trigger creator_styles_embedding_stale after insert or delete on public.creator_styles for each row execute function public.tg_creator_embedding_stale();
create trigger creator_content_types_embedding_stale after insert or delete on public.creator_content_types for each row execute function public.tg_creator_embedding_stale();

-- A profile that stops being a creator (e.g. an account promoted to admin) leaves the embedding queue
create or replace function public.tg_creator_embedding_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.creator_embeddings where creator_id = new.id;
  return null;
end $$;
create trigger profiles_embedding_role after update of role on public.profiles
  for each row when (old.role = 'creator' and new.role <> 'creator') execute function public.tg_creator_embedding_role();

-- The text a creator is embedded from (real profile + portfolio data only)
create or replace function private.creator_embedding_text(p_creator uuid)
returns text language sql stable security definer set search_path = public as $$
  select concat_ws(E'\n',
    'AI creator: ' || p.display_name,
    nullif(trim(p.headline), ''),
    nullif(left(trim(p.bio), 600), ''),
    'Experience: ' || d.experience_level || coalesce(', ' || d.years_experience || ' years', ''),
    'Specializations: ' || (select string_agg(x.name, ', ' order by x.name) from public.creator_categories j join public.categories x on x.id = j.category_id where j.creator_id = p.id),
    'AI tools: ' || (select string_agg(x.name, ', ' order by x.name) from public.creator_tools j join public.ai_tools x on x.id = j.tool_id where j.creator_id = p.id),
    'Skills: ' || (select string_agg(x.name, ', ' order by x.name) from public.creator_skills j join public.skills x on x.id = j.skill_id where j.creator_id = p.id),
    'Styles: ' || (select string_agg(x.name, ', ' order by x.name) from public.creator_styles j join public.styles x on x.id = j.style_id where j.creator_id = p.id),
    'Content types: ' || (select string_agg(x.name, ', ' order by x.name) from public.creator_content_types j join public.content_types x on x.id = j.content_type_id where j.creator_id = p.id),
    'Workflow: ' || nullif(left(trim(d.workflow_overview), 400), ''),
    'Portfolio:' || E'\n' || (select string_agg(format('- %s%s%s%s%s', q.title,
                                 coalesce(' — ' || left(q.description, 160), ''),
                                 coalesce(' [' || q.ct || ']', ''), coalesce(' [' || q.st || ']', ''),
                                 coalesce(' tools: ' || q.tools, '')), E'\n')
      from (select po.title, nullif(trim(po.description), '') as description, ct.name as ct, st.name as st,
                   (select string_agg(t.name, ', ') from public.post_tools pt join public.ai_tools t on t.id = pt.tool_id where pt.post_id = po.id) as tools
            from public.posts po
            left join public.content_types ct on ct.id = po.content_type_id
            left join public.styles st on st.id = po.style_id
            where po.creator_id = p.id and not po.is_removed
            order by po.created_at desc limit 12) q))
  from public.profiles p left join public.creator_details d on d.profile_id = p.id
  where p.id = p_creator;
$$;

-- Server job: creators whose embedding is missing, stale or from another model. Unchanged text just gets un-staled.
create or replace function public.creator_embedding_queue(p_model text, p_limit int default 25)
returns table(creator_id uuid, source text, source_hash text, queued_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  insert into public.creator_embeddings (creator_id)
  select p.id from public.profiles p where p.role = 'creator' and not p.is_suspended
  on conflict do nothing;
  update public.creator_embeddings e set stale = false
  where e.stale and e.embedding is not null and e.model = p_model
    and e.source_hash = md5(coalesce(private.creator_embedding_text(e.creator_id), ''));
  return query
    select e.creator_id, private.creator_embedding_text(e.creator_id), md5(coalesce(private.creator_embedding_text(e.creator_id), '')), now()
    from public.creator_embeddings e join public.profiles p on p.id = e.creator_id
    where p.role = 'creator' and not p.is_suspended
      and (e.stale or e.embedding is null or e.model is distinct from p_model)
    order by e.embedding is null desc, e.marked_at
    limit greatest(least(p_limit, 100), 1);
end $$;

-- Stays stale if the creator changed again while their embedding was being computed
create or replace function public.store_creator_embedding(p_creator uuid, p_embedding text, p_model text, p_hash text, p_queued_at timestamptz)
returns void language sql security definer set search_path = public as $$
  insert into public.creator_embeddings (creator_id, embedding, model, source_hash, stale, embedded_at)
  values (p_creator, p_embedding::extensions.vector, p_model, p_hash, false, now())
  on conflict (creator_id) do update set embedding = excluded.embedding, model = excluded.model, source_hash = excluded.source_hash,
    -- millisecond granularity: clients may round the timestamp they pass back
    embedded_at = now(), stale = date_trunc('milliseconds', public.creator_embeddings.marked_at) > date_trunc('milliseconds', p_queued_at);
$$;

-- ---------------------------------------------------------------------------
-- 10. AI Creator Finder: searches, results, cached reasons
-- ---------------------------------------------------------------------------
create table public.ai_match_searches (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.profiles(id) on delete cascade,
  idea text not null check (char_length(trim(idea)) between 10 and 500),
  requirements jsonb not null default '{}'::jsonb check (jsonb_typeof(requirements) = 'object'),
  mode text not null check (mode in ('semantic', 'tags')),
  notice text check (char_length(notice) <= 300),
  embedding_model text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  result_count int not null default 0,
  created_at timestamptz not null default now()
);
create index ai_match_searches_brand_idx on public.ai_match_searches(brand_id, created_at desc);

create table public.ai_match_results (
  search_id uuid not null references public.ai_match_searches(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  rank int not null,
  score smallint not null check (score between 0 and 100),
  breakdown jsonb not null default '{}'::jsonb,
  saved boolean not null default false,
  primary key (search_id, creator_id)
);
create index ai_match_results_rank_idx on public.ai_match_results(search_id, rank);

create table public.ai_match_reasons (
  search_id uuid not null references public.ai_match_searches(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  reasons jsonb not null check (jsonb_typeof(reasons) = 'array'),
  gaps jsonb not null default '[]'::jsonb check (jsonb_typeof(gaps) = 'array'),
  model text,
  created_at timestamptz not null default now(),
  primary key (search_id, creator_id)
);

alter table public.ai_match_searches enable row level security;
alter table public.ai_match_results enable row level security;
alter table public.ai_match_reasons enable row level security;
create policy "brands see their own AI searches" on public.ai_match_searches for select to authenticated using (brand_id = auth.uid());
create policy "brands delete their own AI searches" on public.ai_match_searches for delete to authenticated using (brand_id = auth.uid());
create policy "results of own searches" on public.ai_match_results for select to authenticated
  using (exists (select 1 from public.ai_match_searches s where s.id = search_id and s.brand_id = auth.uid()));
create policy "reasons of own searches" on public.ai_match_reasons for select to authenticated
  using (exists (select 1 from public.ai_match_searches s where s.id = search_id and s.brand_id = auth.uid()));
revoke all on public.ai_match_searches, public.ai_match_results, public.ai_match_reasons from anon, authenticated;
grant select, delete on public.ai_match_searches to authenticated;
grant select on public.ai_match_results, public.ai_match_reasons to authenticated;
grant all on public.ai_match_searches, public.ai_match_results, public.ai_match_reasons to service_role;

-- Per-brand rate limit, enforced in the database
create or replace function public.tg_ai_match_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.ai_match_searches where brand_id = new.brand_id and created_at > now() - interval '10 minutes') >= 15 then
    raise exception 'Too many AI searches — try again in a few minutes' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger ai_match_rate_limit before insert on public.ai_match_searches for each row execute function public.tg_ai_match_rate_limit();

alter table public.ai_job_logs drop constraint ai_job_logs_job_check;
alter table public.ai_job_logs add constraint ai_job_logs_job_check check (job in
  ('submission_review', 'watermark', 'certificate', 'ai_match', 'ai_match_reason', 'creator_embeddings'));

create or replace function public.create_ai_match_search(p_idea text, p_requirements jsonb, p_mode text, p_notice text,
  p_model text, p_campaign uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_id uuid;
begin
  if public.current_app_role() <> 'brand' then raise exception 'The AI Creator Finder is for brands' using errcode = '42501'; end if;
  if p_campaign is not null and not exists (select 1 from public.campaigns where id = p_campaign and brand_id = v_me) then
    raise exception 'Brief not found' using errcode = '42501';
  end if;
  insert into public.ai_match_searches (brand_id, idea, requirements, mode, notice, embedding_model, campaign_id)
  values (v_me, trim(p_idea), coalesce(p_requirements, '{}'::jsonb), p_mode, left(p_notice, 300), p_model, p_campaign)
  returning id into v_id;
  return v_id;
end $$;

-- Ranks ALL available creators for a search and keeps the top p_keep. Weighted score (weights from
-- src/config/ai-match.ts): semantic similarity + tools / skills / style / content type / specialization overlap
-- + experience & past projects + availability. Components without a requirement drop out of the denominator.
create or replace function public.run_ai_match(p_search uuid, p_query_embedding text, p_weights jsonb, p_keep int default 200)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  v_s public.ai_match_searches;
  v_q extensions.vector;
  v_tools int[]; v_skills int[]; v_ct int; v_st int; v_cat int; v_kw text;
  v_floor float8 := coalesce((p_weights->>'semantic_floor')::float8, 0.45);
  v_ceil float8 := coalesce((p_weights->>'semantic_ceiling')::float8, 0.8);
  w_sem float8 := coalesce((p_weights->>'semantic')::float8, 0);
  w_tools float8 := coalesce((p_weights->>'tools')::float8, 0);
  w_skills float8 := coalesce((p_weights->>'skills')::float8, 0);
  w_style float8 := coalesce((p_weights->>'style')::float8, 0);
  w_ct float8 := coalesce((p_weights->>'content_type')::float8, 0);
  w_cat float8 := coalesce((p_weights->>'specialization')::float8, 0);
  w_exp float8 := coalesce((p_weights->>'experience')::float8, 0);
  w_av float8 := coalesce((p_weights->>'availability')::float8, 0);
  w_kw float8 := coalesce((p_weights->>'keywords')::float8, 0);
  v_n int;
begin
  select * into v_s from public.ai_match_searches where id = p_search for update;
  if v_s.id is null or v_s.brand_id is distinct from auth.uid() then raise exception 'Search not found' using errcode = '42501'; end if;
  if v_ceil <= v_floor then raise exception 'Invalid semantic calibration' using errcode = '22023'; end if;
  v_q := nullif(p_query_embedding, '')::extensions.vector;
  select coalesce(array_agg(x::int), '{}') into v_tools from jsonb_array_elements_text(coalesce(v_s.requirements->'tool_ids', '[]')) x;
  select coalesce(array_agg(x::int), '{}') into v_skills from jsonb_array_elements_text(coalesce(v_s.requirements->'skill_ids', '[]')) x;
  v_ct := nullif(v_s.requirements->>'content_type_id', '')::int;
  v_st := nullif(v_s.requirements->>'style_id', '')::int;
  v_cat := nullif(v_s.requirements->>'category_id', '')::int;
  select string_agg(quote_literal(lower(x)), ' | ') into v_kw
  from jsonb_array_elements_text(coalesce(v_s.requirements->'keywords', '[]')) x where x ~ '^[[:alnum:]-]{3,40}$';

  delete from public.ai_match_results where search_id = p_search;
  with cand as (
    select p.id,
      case when v_q is not null and e.embedding is not null and e.model = v_s.embedding_model then 1 - (e.embedding <=> v_q) end as sim,
      (select count(*) from public.creator_tools j where j.creator_id = p.id and j.tool_id = any(v_tools))::float8 as tool_hits,
      (select array_agg(t.name order by t.name) from public.creator_tools j join public.ai_tools t on t.id = j.tool_id
        where j.creator_id = p.id and j.tool_id = any(v_tools)) as tool_names,
      (select count(*) from public.creator_skills j where j.creator_id = p.id and j.skill_id = any(v_skills))::float8 as skill_hits,
      (select array_agg(t.name order by t.name) from public.creator_skills j join public.skills t on t.id = j.skill_id
        where j.creator_id = p.id and j.skill_id = any(v_skills)) as skill_names,
      (v_st is not null and (exists (select 1 from public.creator_styles j where j.creator_id = p.id and j.style_id = v_st)
                             or exists (select 1 from public.posts po where po.creator_id = p.id and not po.is_removed and po.style_id = v_st))) as style_hit,
      (v_ct is not null and (exists (select 1 from public.creator_content_types j where j.creator_id = p.id and j.content_type_id = v_ct)
                             or exists (select 1 from public.posts po where po.creator_id = p.id and not po.is_removed and po.content_type_id = v_ct))) as ct_hit,
      (v_cat is not null and (exists (select 1 from public.creator_categories j where j.creator_id = p.id and j.category_id = v_cat)
                              or exists (select 1 from public.posts po where po.creator_id = p.id and not po.is_removed and po.category_id = v_cat))) as cat_hit,
      case d.experience_level when 'expert' then 1 when 'professional' then 0.75 when 'intermediate' then 0.5 when 'emerging' then 0.25 else 0.25 end as level,
      least(1, (select count(*) from public.campaign_creators x where x.creator_id = p.id and x.status = 'completed') / 3.0) as past,
      case d.availability when 'open' then 1 when 'limited' then 0.5 when 'booked' then 0 else 0.5 end as avail,
      case when v_kw is null then 0 else greatest(
        ts_rank_cd(p.search, to_tsquery('english', v_kw)),
        coalesce((select max(ts_rank_cd(po.search, to_tsquery('english', v_kw))) from public.posts po where po.creator_id = p.id and not po.is_removed), 0)) end as kw
    from public.profiles p
    left join public.creator_details d on d.profile_id = p.id
    left join public.creator_embeddings e on e.creator_id = p.id
    where p.role = 'creator' and not p.is_suspended and p.onboarded
  ), comp as (
    select c.*,
      case when sim is null then null else least(1, greatest(0, (sim - v_floor) / (v_ceil - v_floor))) end as s_sem,
      case when cardinality(v_tools) > 0 then tool_hits / cardinality(v_tools) end as s_tools,
      case when cardinality(v_skills) > 0 then skill_hits / cardinality(v_skills) end as s_skills,
      case when v_st is not null then style_hit::int::float8 end as s_style,
      case when v_ct is not null then ct_hit::int::float8 end as s_ct,
      case when v_cat is not null then cat_hit::int::float8 end as s_cat,
      0.6 * level + 0.4 * past as s_exp,
      avail::float8 as s_av,
      -- Keyword rank only stands in when there's no semantic signal (fallback mode)
      case when v_q is null and v_kw is not null then case when max(kw) over () > 0 then kw / max(kw) over () else 0 end end as s_kw
    from cand c
  ), scored as (
    select comp.*,
      (coalesce(w_sem * s_sem, 0) + coalesce(w_tools * s_tools, 0) + coalesce(w_skills * s_skills, 0) + coalesce(w_style * s_style, 0)
       + coalesce(w_ct * s_ct, 0) + coalesce(w_cat * s_cat, 0) + w_exp * s_exp + w_av * s_av + coalesce(w_kw * s_kw, 0))
      / nullif((case when s_sem is not null then w_sem else 0 end) + (case when s_tools is not null then w_tools else 0 end)
               + (case when s_skills is not null then w_skills else 0 end) + (case when s_style is not null then w_style else 0 end)
               + (case when s_ct is not null then w_ct else 0 end) + (case when s_cat is not null then w_cat else 0 end)
               + w_exp + w_av + (case when s_kw is not null then w_kw else 0 end), 0) as total
    from comp
  )
  insert into public.ai_match_results (search_id, creator_id, rank, score, breakdown)
  select p_search, id, row_number() over (order by total desc nulls last, id), round(100 * coalesce(total, 0))::smallint,
    jsonb_strip_nulls(jsonb_build_object(
      'semantic', round(100 * s_sem), 'tools', round(100 * s_tools), 'skills', round(100 * s_skills),
      'style', round(100 * s_style), 'content_type', round(100 * s_ct), 'specialization', round(100 * s_cat),
      'experience', round(100 * s_exp), 'availability', round(100 * s_av), 'keywords', round(100 * s_kw),
      'matched_tools', to_jsonb(tool_names), 'matched_skills', to_jsonb(skill_names)))
  from scored
  order by total desc nulls last, id
  limit greatest(least(p_keep, 500), 1);
  get diagnostics v_n = row_count;
  update public.ai_match_searches set result_count = v_n where id = p_search;
  return v_n;
end $$;

create or replace function public.get_ai_match_results(p_search uuid, p_limit int default 12, p_offset int default 0)
returns table(rank int, score smallint, breakdown jsonb, saved boolean, creator jsonb, total_count bigint)
language sql stable security definer set search_path = public as $$
  select r.rank, r.score, r.breakdown, r.saved, public.creator_card(r.creator_id), count(*) over ()
  from public.ai_match_results r join public.ai_match_searches s on s.id = r.search_id
  where r.search_id = p_search and s.brand_id = auth.uid()
  order by r.rank
  limit greatest(least(p_limit, 48), 1) offset greatest(p_offset, 0);
$$;

create or replace function public.set_ai_match_saved(p_search uuid, p_creator uuid, p_saved boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_match_results r set saved = p_saved
  from public.ai_match_searches s
  where r.search_id = p_search and r.creator_id = p_creator and s.id = r.search_id and s.brand_id = auth.uid();
  if not found then raise exception 'Result not found' using errcode = '42501'; end if;
end $$;

-- Real evidence for "Why this creator?" (owner of the search only). The AI may only use what is returned here.
create or replace function public.ai_match_evidence(p_search uuid, p_creator uuid)
returns jsonb language sql stable security definer set search_path = public as $$
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
$$;

-- Backfill: queue every creator for embedding (the server job / npm run ai:embeddings fills them in)
insert into public.creator_embeddings (creator_id)
select id from public.profiles where role = 'creator' on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 11. Privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
revoke all on function public.accept_offer(uuid), public.get_campaign_collaborators(uuid), public.get_negotiation(uuid),
  public.create_ai_match_search(text, jsonb, text, text, text, uuid), public.run_ai_match(uuid, text, jsonb, int),
  public.get_ai_match_results(uuid, int, int), public.set_ai_match_saved(uuid, uuid, boolean), public.ai_match_evidence(uuid, uuid)
  from public, anon;
grant execute on function public.accept_offer(uuid), public.get_campaign_collaborators(uuid), public.get_negotiation(uuid),
  public.create_ai_match_search(text, jsonb, text, text, text, uuid), public.run_ai_match(uuid, text, jsonb, int),
  public.get_ai_match_results(uuid, int, int), public.set_ai_match_saved(uuid, uuid, boolean), public.ai_match_evidence(uuid, uuid)
  to authenticated, service_role;
-- Embedding plumbing is server-only
revoke all on function public.creator_embedding_queue(text, int), public.store_creator_embedding(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.creator_embedding_queue(text, int), public.store_creator_embedding(uuid, text, text, text, timestamptz)
  to service_role;
revoke all on function public.tg_creator_embedding_stale(), public.tg_creator_embedding_role(), public.tg_ai_match_rate_limit(), public.tg_submissions_require_funding()
  from public, anon, authenticated;
