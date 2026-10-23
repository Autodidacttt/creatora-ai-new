-- 0022: Negotiated hiring, published-only shortlists, creator targets, collaborators (group chat + tasks).
--
-- Hiring: Hire opens a campaign-linked conversation; brand and creator negotiate with structured offers
-- (messages.kind = 'offer', terms in messages.payload); once both accept the same offer the creator sends a final
-- proposal (proposals table, versioned); the brand's "Accept & hire" is the ONLY way to hire. hire_creator now takes
-- a proposal id and the price/terms come from that proposal - never from the client. The old 4-argument
-- hire_creator(campaign, creator, amount, currency) is kept only to reject direct hires with a clear error.
-- Shortlists: only on published (active) briefs. Existing draft-brief shortlists stay, flagged.
-- creators_needed: a target (1-100), not a cap; can't be lowered below the creators already hired.
-- Collaborators: one group conversation per campaign once 2+ creators are hired (members kept in sync);
-- campaign_tasks for one creator or the whole group, announced in the right chat.
-- Escrow / payment logic is unchanged: the hire still creates the same campaign_creators + escrow rows.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column type text not null default 'direct' check (type in ('direct', 'group')),
  add column campaign_id uuid references public.campaigns(id) on delete cascade;
alter table public.conversations
  add constraint conversations_group_has_campaign check (type = 'direct' or (campaign_id is not null and dm_key is null));
create unique index conversations_one_group_per_campaign on public.conversations(campaign_id) where type = 'group';
create index conversations_campaign_idx on public.conversations(campaign_id) where campaign_id is not null;

-- messages.kind is the message type: 'user' (plain text), 'system', 'offer', 'proposal', 'task'.
-- Structured kinds carry their data in payload and are only ever written by the RPCs below
-- (clients can insert conversation_id / sender_id / body only).
alter table public.messages drop constraint messages_kind_check;
alter table public.messages
  add constraint messages_kind_check check (kind in ('user', 'system', 'offer', 'proposal', 'task')),
  add column payload jsonb check (payload is null or jsonb_typeof(payload) = 'object');

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  version int not null check (version between 1 and 500),
  -- Whole currency units, the same as campaign_creators.agreed_amount and campaign_applications.proposed_rate
  price int not null check (price between 1 and 10000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object'),
  note text check (char_length(note) <= 2000),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'superseded')),
  sent_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, creator_id, version)
);
create unique index proposals_one_accepted on public.proposals(campaign_id, creator_id) where status = 'accepted';
create index proposals_creator_idx on public.proposals(creator_id);
alter table public.proposals enable row level security;
create policy "proposals visible to the two parties" on public.proposals for select to authenticated
  using (creator_id = auth.uid() or public.owns_campaign(campaign_id) or public.is_admin());
revoke all on public.proposals from anon, authenticated;
grant select on public.proposals to authenticated;
grant all on public.proposals to service_role;

create table public.campaign_tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 140),
  description text check (char_length(description) <= 2000),
  due_date date,
  scope text not null check (scope in ('individual', 'group')),
  assigned_to uuid references public.profiles(id) on delete cascade,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'individual') = (assigned_to is not null))
);
create index campaign_tasks_campaign_idx on public.campaign_tasks(campaign_id, created_at desc);
create index campaign_tasks_assignee_idx on public.campaign_tasks(assigned_to) where assigned_to is not null;
create trigger campaign_tasks_touch before update on public.campaign_tasks for each row execute function public.touch_updated_at();

-- Hired, not cancelled/rejected: the definition of a collaborator everywhere below
create or replace function public.is_campaign_collaborator(p_campaign uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campaign_creators x where x.campaign_id = p_campaign and x.creator_id = p_user
                 and x.hired_at is not null and x.status not in ('cancelled', 'rejected'));
$$;

alter table public.campaign_tasks enable row level security;
create policy "tasks visible to the brand and its creators" on public.campaign_tasks for select to authenticated
  using (public.owns_campaign(campaign_id) or assigned_to = auth.uid() or public.is_admin()
         or (scope = 'group' and public.is_campaign_collaborator(campaign_id, auth.uid())));
revoke all on public.campaign_tasks from anon, authenticated;
grant select on public.campaign_tasks to authenticated;
grant all on public.campaign_tasks to service_role;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in
  ('follow', 'like', 'comment', 'application', 'shortlisted', 'selected', 'message', 'verification', 'project', 'payment',
   'opportunity', 'proposal', 'task'));

-- ---------------------------------------------------------------------------
-- 2. Shortlists only on published briefs
-- ---------------------------------------------------------------------------
alter table public.campaign_shortlists add column added_while_draft boolean not null default false;
update public.campaign_shortlists s set added_while_draft = true
  from public.campaigns c where c.id = s.campaign_id and c.status = 'draft';

create or replace function public.tg_shortlists_require_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.campaigns where id = new.campaign_id and status = 'active') then
    raise exception 'Publish the brief first — creators can only be shortlisted on a published brief' using errcode = '23514';
  end if;
  new.added_while_draft := false;
  return new;
end $$;
create trigger shortlists_require_published before insert on public.campaign_shortlists
  for each row execute function public.tg_shortlists_require_published();

drop policy "shortlists brand insert" on public.campaign_shortlists;
create policy "shortlists brand insert" on public.campaign_shortlists for insert to authenticated
  with check (public.owns_campaign(campaign_id) and added_by = auth.uid()
              and exists (select 1 from public.profiles p where p.id = creator_id and p.role = 'creator')
              and exists (select 1 from public.campaigns c where c.id = campaign_id and c.status = 'active'));

-- ---------------------------------------------------------------------------
-- 3. creators_needed is a target: 1-100, never below the creators already hired
-- ---------------------------------------------------------------------------
alter table public.campaigns drop constraint campaigns_creators_needed_check;
alter table public.campaigns add constraint campaigns_creators_needed_check check (creators_needed between 1 and 100);

create or replace function public.tg_campaigns_target_floor()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_hired int;
begin
  if new.creators_needed < old.creators_needed then
    select count(*) into v_hired from public.campaign_creators x
    where x.campaign_id = new.id and x.hired_at is not null and x.status not in ('cancelled', 'rejected');
    if new.creators_needed < v_hired then
      raise exception 'This brief already has % hired creator% — the target can''t be lower than that', v_hired,
        case when v_hired = 1 then '' else 's' end using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger campaigns_target_floor before update of creators_needed on public.campaigns
  for each row execute function public.tg_campaigns_target_floor();

-- ---------------------------------------------------------------------------
-- 4. Campaign conversations + negotiation helpers
-- ---------------------------------------------------------------------------
-- One 1:1 conversation per (campaign, brand, creator); plain DMs (dm_key "a:b") are untouched
create or replace function private.campaign_dm_key(p_campaign uuid, p_a uuid, p_b uuid)
returns text language sql immutable as $$
  select 'c:' || p_campaign::text || ':' || least(p_a::text, p_b::text) || ':' || greatest(p_a::text, p_b::text);
$$;

create or replace function private.ensure_campaign_dm(p_campaign uuid, p_brand uuid, p_creator uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_key text := private.campaign_dm_key(p_campaign, p_brand, p_creator); v_id uuid;
begin
  insert into public.conversations (dm_key, type, campaign_id) values (v_key, 'direct', p_campaign)
    on conflict (dm_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.conversations where dm_key = v_key; end if;
  insert into public.conversation_participants (conversation_id, user_id) values (v_id, p_brand), (v_id, p_creator)
    on conflict do nothing;
  return v_id;
end $$;

create or replace function private.post_message(p_conversation uuid, p_sender uuid, p_kind text, p_body text, p_payload jsonb default null)
returns uuid language sql security definer set search_path = public as $$
  insert into public.messages (conversation_id, sender_id, body, kind, payload)
  values (p_conversation, p_sender, left(p_body, 4000), p_kind, p_payload) returning id;
$$;

-- Validates and normalises offer / proposal terms: deliverables, deadline, revisions, usage_rights
create or replace function private.clean_terms(p_terms jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v_t jsonb := coalesce(p_terms, '{}'::jsonb);
  v_deliv text := nullif(trim(v_t->>'deliverables'), '');
  v_deadline date;
  v_rev int;
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
  begin
    v_rev := coalesce(nullif(v_t->>'revisions', '')::int, 0);
  exception when others then
    raise exception 'Invalid number of revisions' using errcode = '22023';
  end;
  if v_rev < 0 or v_rev > 20 then raise exception 'Revisions must be between 0 and 20' using errcode = '23514'; end if;
  if jsonb_typeof(coalesce(v_t->'usage_rights', '[]'::jsonb)) <> 'array' then raise exception 'Invalid usage rights' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_rights from jsonb_array_elements_text(coalesce(v_t->'usage_rights', '[]'::jsonb)) x;
  if not (v_rights <@ array['organic_social', 'paid_social', 'broadcast', 'ooh', 'web', 'internal']) then
    raise exception 'Unknown usage right' using errcode = '23514';
  end if;
  return jsonb_build_object('deliverables', v_deliv, 'deadline', v_deadline, 'revisions', v_rev, 'usage_rights', to_jsonb(v_rights));
end $$;

create or replace function private.terms_label(p_price int, p_currency text, p_terms jsonb)
returns text language sql immutable as $$
  select private.money(p_price, p_currency)
    || coalesce(' · due ' || to_char((p_terms->>'deadline')::date, 'Mon DD, YYYY'), '')
    || ' · ' || coalesce(p_terms->>'revisions', '0') || ' revision' || case when coalesce(p_terms->>'revisions', '0') = '1' then '' else 's' end
    || ' · ' || left(coalesce(p_terms->>'deliverables', ''), 120);
$$;

-- The campaign + both parties of a campaign conversation, if the caller is one of them
create or replace function private.negotiation_parties(p_conversation uuid, p_me uuid,
  out campaign public.campaigns, out brand_id uuid, out creator_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_conv public.conversations;
begin
  select * into v_conv from public.conversations where id = p_conversation;
  if v_conv.id is null or v_conv.type <> 'direct' or v_conv.campaign_id is null
     or not exists (select 1 from public.conversation_participants where conversation_id = p_conversation and user_id = p_me) then
    raise exception 'Negotiation not found' using errcode = '42501';
  end if;
  select * into campaign from public.campaigns where id = v_conv.campaign_id;
  brand_id := campaign.brand_id;
  select cp.user_id into creator_id from public.conversation_participants cp
  where cp.conversation_id = p_conversation and cp.user_id <> campaign.brand_id limit 1;
end $$;

-- Hired on agreed terms. A legacy hire with no fee and no escrow yet still negotiates: accepting the final
-- proposal then sets its fee and opens the escrow, exactly like a new hire.
create or replace function private.is_hired(p_campaign uuid, p_creator uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campaign_creators x where x.campaign_id = p_campaign and x.creator_id = p_creator
                 and x.hired_at is not null and x.status not in ('cancelled', 'rejected')
                 and (x.agreed_amount is not null or exists (select 1 from public.escrow_payments e where e.campaign_creator_id = x.id)));
$$;

-- Keeps a proposal and its chat card in step
create or replace function private.set_proposal_status(p_proposal uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.proposals set status = p_status,
    decided_at = case when p_status in ('accepted', 'rejected') then now() else decided_at end
  where id = p_proposal;
  update public.messages set payload = payload || jsonb_build_object('status', p_status)
  where kind = 'proposal' and payload->>'proposal_id' = p_proposal::text;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Negotiation RPCs
-- ---------------------------------------------------------------------------
-- Brand clicks Hire: opens (or creates) the campaign conversation. Nothing is hired here.
create or replace function public.start_negotiation(p_campaign uuid, p_creator uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_c public.campaigns; v_conv uuid; v_new boolean;
begin
  select * into v_c from public.campaigns where id = p_campaign;
  if v_c.id is null or v_c.brand_id <> v_me then
    raise exception 'Only the brand that owns this brief can open a hiring conversation' using errcode = '42501';
  end if;
  if v_c.status = 'completed' then raise exception 'This brief is already completed' using errcode = '23514'; end if;
  if not exists (select 1 from public.profiles where id = p_creator and role = 'creator' and not is_suspended) then
    raise exception 'Creator not found';
  end if;
  v_new := not exists (select 1 from public.conversations where dm_key = private.campaign_dm_key(p_campaign, v_me, p_creator));
  v_conv := private.ensure_campaign_dm(p_campaign, v_me, p_creator);
  if v_new then
    perform private.post_message(v_conv, v_me, 'system',
      format('Hiring conversation for “%s”. Agree the terms with offers here; the creator then sends a final proposal, and the hire happens only when the brand accepts it.', v_c.title));
    perform public.notify(p_creator, v_me, 'proposal', 'conversation', v_conv,
      jsonb_build_object('event', 'negotiation_opened', 'campaign_id', p_campaign, 'campaign_title', v_c.title));
  end if;
  return v_conv;
end $$;

-- A structured offer (either side). It replaces any open offer, and re-opens terms that were agreed
-- or a final proposal that is waiting: the brand can only accept what both sides last agreed.
create or replace function public.send_offer(p_conversation uuid, p_price int, p_terms jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := private.assert_active();
  v_p record;
  v_terms jsonb;
  v_id uuid;
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
  for r in select id from public.proposals
           where campaign_id = (v_p.campaign).id and creator_id = v_p.creator_id and status in ('draft', 'sent') loop
    perform private.set_proposal_status(r.id, 'superseded');
  end loop;

  v_id := private.post_message(p_conversation, v_me, 'offer',
    'Offer: ' || private.terms_label(p_price, (v_p.campaign).currency, v_terms),
    jsonb_build_object('price', p_price, 'currency', (v_p.campaign).currency, 'terms', v_terms, 'status', 'open',
                       'by', case when v_me = v_p.brand_id then 'brand' else 'creator' end));
  perform public.notify(case when v_me = v_p.brand_id then v_p.creator_id else v_p.brand_id end, v_me, 'proposal',
    'conversation', p_conversation, jsonb_build_object('event', 'offer', 'campaign_id', (v_p.campaign).id,
      'campaign_title', (v_p.campaign).title, 'amount_label', private.money(p_price, (v_p.campaign).currency)));
  return v_id;
end $$;

-- The other side accepts the latest open offer: terms are agreed
create or replace function public.accept_offer(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_m public.messages; v_p record;
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
  update public.messages set payload = payload || jsonb_build_object('status', 'accepted', 'accepted_by', v_me, 'accepted_at', now())
  where id = p_message;
  perform private.post_message(v_m.conversation_id, v_me, 'system',
    'Terms agreed: ' || private.terms_label((v_m.payload->>'price')::int, v_m.payload->>'currency', v_m.payload->'terms')
    || '. The creator can now send the final proposal.');
  perform public.notify(v_m.sender_id, v_me, 'proposal', 'conversation', v_m.conversation_id,
    jsonb_build_object('event', 'offer_accepted', 'campaign_id', (v_p.campaign).id, 'campaign_title', (v_p.campaign).title,
                       'amount_label', private.money((v_m.payload->>'price')::int, v_m.payload->>'currency')));
end $$;

-- Creator sends the final proposal: a new version built from the agreed terms (older versions are superseded)
create or replace function public.send_final_proposal(p_conversation uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := private.assert_active();
  v_p record;
  v_offer public.messages;
  v_id uuid;
  v_version int;
  r record;
begin
  select * into v_p from private.negotiation_parties(p_conversation, v_me);
  if v_me <> v_p.creator_id then raise exception 'Only the creator sends the final proposal' using errcode = '42501'; end if;
  if private.is_hired((v_p.campaign).id, v_me) then raise exception 'You are already hired for this brief' using errcode = '23514'; end if;
  select * into v_offer from public.messages where conversation_id = p_conversation and kind = 'offer'
  order by created_at desc limit 1;
  if v_offer.id is null or v_offer.payload->>'status' <> 'accepted' then
    raise exception 'Agree the terms first — both sides must accept the same offer' using errcode = '23514';
  end if;
  if char_length(coalesce(p_note, '')) > 2000 then raise exception 'The note is too long' using errcode = '23514'; end if;

  for r in select id from public.proposals
           where campaign_id = (v_p.campaign).id and creator_id = v_me and status in ('draft', 'sent') loop
    perform private.set_proposal_status(r.id, 'superseded');
  end loop;
  perform pg_advisory_xact_lock(hashtext('proposal:' || (v_p.campaign).id::text || v_me::text));
  select coalesce(max(version), 0) + 1 into v_version from public.proposals where campaign_id = (v_p.campaign).id and creator_id = v_me;
  insert into public.proposals (campaign_id, creator_id, conversation_id, version, price, currency, terms, note, status, sent_at)
  values ((v_p.campaign).id, v_me, p_conversation, v_version, (v_offer.payload->>'price')::int, v_offer.payload->>'currency',
          v_offer.payload->'terms' || jsonb_build_object('offer_message_id', v_offer.id), nullif(trim(p_note), ''), 'sent', now())
  returning id into v_id;
  perform private.post_message(p_conversation, v_me, 'proposal',
    format('Final proposal v%s: %s', v_version, private.terms_label((v_offer.payload->>'price')::int, v_offer.payload->>'currency', v_offer.payload->'terms')),
    jsonb_build_object('proposal_id', v_id, 'version', v_version, 'price', (v_offer.payload->>'price')::int,
                       'currency', v_offer.payload->>'currency', 'terms', v_offer.payload->'terms', 'note', nullif(trim(p_note), ''), 'status', 'sent'));
  perform public.notify(v_p.brand_id, v_me, 'proposal', 'conversation', p_conversation,
    jsonb_build_object('event', 'proposal_sent', 'campaign_id', (v_p.campaign).id, 'campaign_title', (v_p.campaign).title,
                       'version', v_version, 'amount_label', private.money((v_offer.payload->>'price')::int, v_offer.payload->>'currency')));
  return v_id;
end $$;

create or replace function public.reject_proposal(p_proposal uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_pr public.proposals; v_c public.campaigns;
begin
  select * into v_pr from public.proposals where id = p_proposal for update;
  select * into v_c from public.campaigns where id = v_pr.campaign_id;
  if v_pr.id is null or v_c.brand_id is distinct from v_me then raise exception 'Proposal not found' using errcode = '42501'; end if;
  if v_pr.status <> 'sent' then raise exception 'This proposal is %', v_pr.status using errcode = '23514'; end if;
  perform private.set_proposal_status(p_proposal, 'rejected');
  if v_pr.conversation_id is not null then
    perform private.post_message(v_pr.conversation_id, v_me, 'system',
      format('Final proposal v%s declined%s. Keep negotiating with a new offer.', v_pr.version,
             coalesce(': ' || nullif(left(trim(p_reason), 300), ''), '')));
  end if;
  perform public.notify(v_pr.creator_id, v_me, 'proposal', 'conversation', v_pr.conversation_id,
    jsonb_build_object('event', 'proposal_rejected', 'campaign_id', v_c.id, 'campaign_title', v_c.title, 'version', v_pr.version));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Hiring: only by accepting a final proposal
-- ---------------------------------------------------------------------------
-- The pre-0022 hire_creator body, unchanged except that the caller is passed in (it still creates the same
-- campaign_creators + escrow rows). Not callable by clients.
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
end $function$;

-- Brand: "Accept & hire". The only hire path: the proposal must be the creator's latest SENT version;
-- price, currency and terms come from it.
create or replace function public.hire_creator(p_proposal uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_pr public.proposals; v_c public.campaigns; v_project uuid;
begin
  select * into v_pr from public.proposals where id = p_proposal for update;
  select * into v_c from public.campaigns where id = v_pr.campaign_id;
  if v_pr.id is null or v_c.brand_id is distinct from v_me then
    raise exception 'Only the brand that owns this brief can accept the proposal' using errcode = '42501';
  end if;
  if v_pr.status <> 'sent' then
    raise exception 'Only a sent final proposal can be accepted (this one is %)', v_pr.status using errcode = '23514';
  end if;
  if exists (select 1 from public.proposals where campaign_id = v_pr.campaign_id and creator_id = v_pr.creator_id and version > v_pr.version) then
    raise exception 'A newer proposal replaced this one' using errcode = '23514';
  end if;
  v_project := private.do_hire(v_me, v_pr.campaign_id, v_pr.creator_id, v_pr.price, v_pr.currency);
  perform private.set_proposal_status(p_proposal, 'accepted');
  if v_pr.conversation_id is not null then
    perform private.post_message(v_pr.conversation_id, v_me, 'system',
      format('Final proposal v%s accepted — hired at %s. The brief is final for this collaboration.', v_pr.version,
             private.money(v_pr.price, v_pr.currency)));
  end if;
  perform public.notify(v_pr.creator_id, v_me, 'proposal', 'conversation', v_pr.conversation_id,
    jsonb_build_object('event', 'proposal_accepted', 'campaign_id', v_c.id, 'campaign_title', v_c.title,
                       'version', v_pr.version, 'amount_label', private.money(v_pr.price, v_pr.currency), 'project_id', v_project));
  perform public.notify(v_me, null, 'proposal', 'conversation', v_pr.conversation_id,
    jsonb_build_object('event', 'hired_confirmed', 'campaign_id', v_c.id, 'campaign_title', v_c.title,
                       'creator_id', v_pr.creator_id, 'amount_label', private.money(v_pr.price, v_pr.currency), 'project_id', v_project));
  return v_project;
end $$;

-- The pre-0022 direct hire (client-supplied amount) now always refuses
create or replace function public.hire_creator(p_campaign uuid, p_creator uuid, p_amount integer, p_currency text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Direct hiring is disabled: negotiate in chat and accept the creator''s final proposal to hire' using errcode = '42501';
end $$;

-- Undoing an untouched hire also retires the proposal it came from (a later re-hire needs a new one)
create or replace function public.unhire_creator(p_campaign uuid, p_creator uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_x public.campaign_creators; r record;
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
  for r in select id from public.proposals where campaign_id = p_campaign and creator_id = p_creator and status = 'accepted' loop
    perform private.set_proposal_status(r.id, 'superseded');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Collaborators: group conversation per campaign
-- ---------------------------------------------------------------------------
-- From the 2nd hired creator on: one group (brand + every collaborator). Joins and leaves follow campaign_creators.
create or replace function private.sync_campaign_group(p_campaign uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_c public.campaigns; v_conv uuid; v_n int; r record;
begin
  perform pg_advisory_xact_lock(hashtext('group:' || p_campaign::text));
  select * into v_c from public.campaigns where id = p_campaign;
  if v_c.id is null then return null; end if;
  select count(*) into v_n from public.campaign_creators x
  where x.campaign_id = p_campaign and x.hired_at is not null and x.status not in ('cancelled', 'rejected');
  select id into v_conv from public.conversations where campaign_id = p_campaign and type = 'group';
  if v_conv is null then
    if v_n < 2 then return null; end if;
    insert into public.conversations (type, campaign_id) values ('group', p_campaign) returning id into v_conv;
    insert into public.conversation_participants (conversation_id, user_id) values (v_conv, v_c.brand_id) on conflict do nothing;
    perform private.post_message(v_conv, v_c.brand_id, 'system',
      format('Group chat for “%s” — the brand and every hired creator. Group tasks are posted here.', v_c.title));
  end if;
  for r in select x.creator_id, p.display_name from public.campaign_creators x join public.profiles p on p.id = x.creator_id
           where x.campaign_id = p_campaign and x.hired_at is not null and x.status not in ('cancelled', 'rejected')
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

create or replace function public.tg_campaign_creators_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform private.sync_campaign_group(case when tg_op = 'DELETE' then old.campaign_id else new.campaign_id end);
  return null;
end $$;
create trigger campaign_creators_group after insert or delete or update of status, hired_at on public.campaign_creators
  for each row execute function public.tg_campaign_creators_group();

-- ---------------------------------------------------------------------------
-- 8. Tasks
-- ---------------------------------------------------------------------------
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
    raise exception 'Tasks can only be assigned to creators hired for this brief' using errcode = '23514';
  end if;
  if p_assignee is null and not exists (select 1 from public.campaign_creators x where x.campaign_id = p_campaign
                                        and x.hired_at is not null and x.status not in ('cancelled', 'rejected')) then
    raise exception 'Hire a creator before assigning group tasks' using errcode = '23514';
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
           where x.campaign_id = p_campaign and x.hired_at is not null and x.status not in ('cancelled', 'rejected')
             and (p_assignee is null or x.creator_id = p_assignee) loop
    -- Only one collaborator: the "group" has no chat yet, so the task goes to their own campaign chat
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

-- Brand, the assignee, or (group tasks) any collaborator
create or replace function public.update_campaign_task_status(p_task uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_t public.campaign_tasks; v_c public.campaigns; v_project uuid; v_name text;
begin
  select * into v_t from public.campaign_tasks where id = p_task for update;
  select * into v_c from public.campaigns where id = v_t.campaign_id;
  if v_t.id is null or not (v_c.brand_id = v_me or v_t.assigned_to = v_me
                            or (v_t.scope = 'group' and public.is_campaign_collaborator(v_t.campaign_id, v_me))) then
    raise exception 'Task not found' using errcode = '42501';
  end if;
  if p_status not in ('todo', 'in_progress', 'done') then raise exception 'Invalid task status' using errcode = '22023'; end if;
  if p_status = v_t.status then return; end if;
  update public.campaign_tasks set status = p_status where id = p_task;
  if v_me <> v_c.brand_id then
    select x.id into v_project from public.campaign_creators x where x.campaign_id = v_t.campaign_id and x.creator_id = v_me;
    select display_name into v_name from public.profiles where id = v_me;
    perform public.notify(v_c.brand_id, v_me, 'task', 'project', v_project,
      jsonb_build_object('event', 'task_' || p_status, 'task_id', v_t.id, 'title', v_t.title, 'campaign_title', v_c.title));
    perform private.post_message(
      coalesce(case when v_t.scope = 'group' then (select id from public.conversations where campaign_id = v_t.campaign_id and type = 'group') end,
               private.ensure_campaign_dm(v_t.campaign_id, v_c.brand_id, v_me)),
      v_me, 'system', format('%s marked “%s” as %s.', v_name, v_t.title, replace(p_status, '_', ' ')));
  end if;
end $$;

create or replace function public.delete_campaign_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active();
begin
  delete from public.campaign_tasks t using public.campaigns c
  where t.id = p_task and c.id = t.campaign_id and c.brand_id = v_me;
  if not found then raise exception 'Task not found' using errcode = '42501'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Chat plumbing
-- ---------------------------------------------------------------------------
-- Only plain text messages raise "new message" notifications; offers, proposals and tasks notify on their own
create or replace function public.tg_notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.kind <> 'user' then return null; end if;
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

-- Project updates go to the campaign conversation when there is one (new hires), else the pair DM (as before)
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
  v_conv := coalesce((select id from public.conversations where dm_key = private.campaign_dm_key(v.campaign_id, v.brand_id, v.creator_id)),
                     private.ensure_dm(v.brand_id, v.creator_id));
  insert into public.messages (conversation_id, sender_id, body, kind, created_at)
  values (v_conv, coalesce(new.actor_id, v.brand_id), v_body, 'system', new.created_at);
  return null;
end $$;

-- Inbox: one row per conversation. Groups show the brief; campaign 1:1 chats carry the brief they're about.
drop function public.get_inbox(text, text, int, int);
create function public.get_inbox(p_other_role text default null, p_query text default null, p_limit int default 30, p_offset int default 0)
returns table(conversation_id uuid, last_message_at timestamptz, last_message_preview text, last_sender_id uuid,
              unread_count int, other jsonb, total_count bigint, conversation_type text, campaign jsonb)
-- security definer: only the caller's own conversations; a hired creator still sees a draft brief's group chat
language sql stable security definer set search_path = public as $$
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
$$;

-- Thread header: type, brief and members (participants only)
create or replace function public.get_conversation(p_conversation uuid)
returns jsonb language sql stable security definer set search_path = public as $$
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
$$;

-- The pinned negotiation card: brief summary, creator's proposed price, terms status
create or replace function public.get_negotiation(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_conv public.conversations; v_c public.campaigns; v_creator uuid; v_offer public.messages; v_pr public.proposals;
        v_x public.campaign_creators; v_app public.campaign_applications; v_state text;
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
  v_state := case
    when private.is_hired(v_c.id, v_creator) then 'hired'
    when v_pr.status = 'sent' then 'proposal_sent'
    when v_offer.payload->>'status' = 'accepted' then 'agreed'
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
    'project', case when v_x.id is not null and v_x.hired_at is not null then jsonb_build_object('id', v_x.id, 'status', v_x.status) end);
end $$;

-- ---------------------------------------------------------------------------
-- 10. Brand read models
-- ---------------------------------------------------------------------------
drop function public.get_campaign_applications(uuid);
create function public.get_campaign_applications(p_campaign uuid)
returns table(id uuid, pitch text, proposed_rate int, status text, created_at timestamptz, creator jsonb,
              shortlisted boolean, selected boolean, proposal jsonb, conversation_id uuid)
language sql stable set search_path = public as $$
  select a.id, a.pitch, a.proposed_rate, a.status, a.created_at, public.creator_card(a.creator_id),
    exists (select 1 from public.campaign_shortlists s where s.campaign_id = a.campaign_id and s.creator_id = a.creator_id),
    exists (select 1 from public.campaign_creators s where s.campaign_id = a.campaign_id and s.creator_id = a.creator_id and s.hired_at is not null),
    (select jsonb_build_object('status', p.status, 'version', p.version, 'price', p.price, 'currency', p.currency)
     from public.proposals p where p.campaign_id = a.campaign_id and p.creator_id = a.creator_id order by p.version desc limit 1),
    (select c.id from public.conversations c join public.campaigns x on x.id = a.campaign_id
     where c.dm_key = 'c:' || a.campaign_id::text || ':' || least(x.brand_id::text, a.creator_id::text) || ':' || greatest(x.brand_id::text, a.creator_id::text))
  from public.campaign_applications a
  where a.campaign_id = p_campaign and a.status <> 'withdrawn'
  order by a.created_at desc;
$$;

drop function public.get_campaign_pipeline(uuid);
create function public.get_campaign_pipeline(p_campaign uuid)
returns table(creator jsonb, stage text, note text, created_at timestamptz, applied boolean, added_while_draft boolean)
language sql stable set search_path = public as $$
  select public.creator_card(s.creator_id), 'shortlisted', s.note, s.created_at,
         exists (select 1 from public.campaign_applications a where a.campaign_id = s.campaign_id
                 and a.creator_id = s.creator_id and a.status <> 'withdrawn'),
         s.added_while_draft
  from public.campaign_shortlists s where s.campaign_id = p_campaign
  union all
  select public.creator_card(x.creator_id), case when x.status = 'completed' then 'completed' else 'selected' end, null,
         coalesce(x.hired_at, x.created_at),
         exists (select 1 from public.campaign_applications a where a.campaign_id = x.campaign_id
                 and a.creator_id = x.creator_id and a.status <> 'withdrawn'),
         false
  from public.campaign_creators x
  where x.campaign_id = p_campaign and x.hired_at is not null and x.status not in ('cancelled', 'rejected')
  order by 4 desc;
$$;

-- Collaborators panel: members, group chat, tasks (brand: everything; a collaborator: group tasks + their own)
create or replace function public.get_campaign_collaborators(p_campaign uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'campaign', jsonb_build_object('id', c.id, 'title', c.title, 'status', c.status, 'creators_needed', c.creators_needed),
    'count', (select count(*) from public.campaign_creators x where x.campaign_id = c.id and x.hired_at is not null
              and x.status not in ('cancelled', 'rejected')),
    'group_conversation_id', (select g.id from public.conversations g where g.campaign_id = c.id and g.type = 'group'
                              and public.is_participant(g.id)),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'creator', public.mini_profile_json(x.creator_id), 'project_id', x.id, 'status', x.status, 'hired_at', x.hired_at,
        'agreed_amount', case when c.brand_id = auth.uid() then x.agreed_amount end, 'currency', x.currency,
        'conversation_id', case when c.brand_id = auth.uid() then
          (select d.id from public.conversations d where d.dm_key = private.campaign_dm_key(c.id, c.brand_id, x.creator_id)) end)
        order by x.hired_at)
      from public.campaign_creators x where x.campaign_id = c.id and x.hired_at is not null and x.status not in ('cancelled', 'rejected')), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('assignee', case when t.assigned_to is not null
                                          then public.mini_profile_json(t.assigned_to) end) order by t.status = 'done', t.due_date nulls last, t.created_at desc)
      from public.campaign_tasks t where t.campaign_id = c.id
        and (c.brand_id = auth.uid() or t.scope = 'group' or t.assigned_to = auth.uid())), '[]'::jsonb))
  from public.campaigns c
  where c.id = p_campaign and (c.brand_id = auth.uid() or public.is_campaign_collaborator(c.id, auth.uid()) or public.is_admin());
$$;

-- ---------------------------------------------------------------------------
-- 11. Backfill: existing hires keep working
-- ---------------------------------------------------------------------------
-- Every existing hire with agreed terms becomes an accepted v1 proposal at the amount it was hired for.
-- (Legacy hires with no fee and no escrow get theirs by negotiating; see private.is_hired.)
insert into public.proposals (campaign_id, creator_id, conversation_id, version, price, currency, terms, status, sent_at, decided_at, created_at)
select x.campaign_id, x.creator_id,
       (select d.id from public.conversations d where d.dm_key = least(c.brand_id::text, x.creator_id::text) || ':' || greatest(c.brand_id::text, x.creator_id::text)),
       1, greatest(1, coalesce(x.agreed_amount, e.amount, 1)), coalesce(e.currency, x.currency),
       jsonb_build_object('deliverables', coalesce(nullif(trim(c.deliverables), ''), 'As described in the brief'),
                          'deadline', c.deadline, 'revisions', 0, 'usage_rights', to_jsonb(c.usage_rights), 'backfilled', true),
       'accepted', x.hired_at, x.hired_at, x.hired_at
from public.campaign_creators x
join public.campaigns c on c.id = x.campaign_id
left join public.escrow_payments e on e.campaign_creator_id = x.id
where x.hired_at is not null and (x.agreed_amount is not null or e.id is not null)
on conflict do nothing;

-- Briefs that already have 2+ collaborators get their group chat now
do $$
declare r record;
begin
  for r in select x.campaign_id from public.campaign_creators x
           where x.hired_at is not null and x.status not in ('cancelled', 'rejected')
           group by x.campaign_id having count(*) >= 2 loop
    perform private.sync_campaign_group(r.campaign_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 12. Privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;

revoke all on function
  public.start_negotiation(uuid, uuid), public.send_offer(uuid, int, jsonb), public.accept_offer(uuid),
  public.send_final_proposal(uuid, text), public.reject_proposal(uuid, text), public.hire_creator(uuid),
  public.hire_creator(uuid, uuid, int, text), public.create_campaign_task(uuid, text, text, date, uuid),
  public.update_campaign_task_status(uuid, text), public.delete_campaign_task(uuid), public.get_conversation(uuid),
  public.get_negotiation(uuid), public.get_campaign_collaborators(uuid), public.get_inbox(text, text, int, int),
  public.get_campaign_applications(uuid), public.get_campaign_pipeline(uuid), public.is_campaign_collaborator(uuid, uuid)
  from public, anon;
grant execute on function
  public.start_negotiation(uuid, uuid), public.send_offer(uuid, int, jsonb), public.accept_offer(uuid),
  public.send_final_proposal(uuid, text), public.reject_proposal(uuid, text), public.hire_creator(uuid),
  public.hire_creator(uuid, uuid, int, text), public.create_campaign_task(uuid, text, text, date, uuid),
  public.update_campaign_task_status(uuid, text), public.delete_campaign_task(uuid), public.get_conversation(uuid),
  public.get_negotiation(uuid), public.get_campaign_collaborators(uuid), public.get_inbox(text, text, int, int),
  public.get_campaign_applications(uuid), public.get_campaign_pipeline(uuid), public.is_campaign_collaborator(uuid, uuid)
  to authenticated, service_role;

revoke all on function public.tg_shortlists_require_published(), public.tg_campaigns_target_floor(),
  public.tg_campaign_creators_group() from public, anon, authenticated;
