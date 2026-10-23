-- Rollback of 0024 + 0023 to the 0022 schema (generated from it; verified locally to reproduce 0022 exactly,
-- except ai_job_logs_job_check, which stays widened so existing AI job log rows remain valid).
-- Data kept: every project, payment, proposal and message. Projects waiting for funding go back to 'hired'
-- (0022 semantics), and agreements that weren't hired yet go back to "final proposal sent", so the 0022 app can
-- Accept & hire them (they rejoin campaign group chats; the sync posts "joined the group"). Removed: the AI Creator Finder tables (search history, cached reasons, creator vectors), which
-- 0023 can rebuild. Not restorable: the "revisions" values 0024 stripped from offer terms (cosmetic only).
-- Usage (after promoting the previous Vercel deployment): psql "$SUPABASE_DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/rollback/0023_0024_down.sql
set local check_function_bodies = off;
set local lock_timeout = '5s';

-- 1. AI Creator Finder objects (0023)
drop trigger if exists submissions_require_funding on public.submissions;
drop trigger if exists profiles_embedding_stale on public.profiles;
drop trigger if exists creator_details_embedding_stale on public.creator_details;
drop trigger if exists posts_embedding_stale on public.posts;
drop trigger if exists post_tools_embedding_stale on public.post_tools;
drop trigger if exists creator_tools_embedding_stale on public.creator_tools;
drop trigger if exists creator_skills_embedding_stale on public.creator_skills;
drop trigger if exists creator_categories_embedding_stale on public.creator_categories;
drop trigger if exists creator_styles_embedding_stale on public.creator_styles;
drop trigger if exists creator_content_types_embedding_stale on public.creator_content_types;
drop trigger if exists profiles_embedding_role on public.profiles;
drop table if exists public.creator_embeddings cascade;
drop table if exists public.ai_match_searches cascade;
drop table if exists public.ai_match_results cascade;
drop table if exists public.ai_match_reasons cascade;
drop function if exists public.tg_creator_embedding_stale();
drop function if exists public.tg_ai_match_rate_limit();
drop function if exists public.tg_submissions_require_funding();
drop function if exists public.creator_embedding_queue(p_model text, p_limit integer);
drop function if exists public.get_ai_match_results(p_search uuid, p_limit integer, p_offset integer);
drop function if exists public.run_ai_match(p_search uuid, p_query_embedding text, p_weights jsonb, p_keep integer);
drop function if exists private.mark_creator_stale(p_creator uuid);
drop function if exists public.tg_creator_embedding_role();
drop function if exists public.create_ai_match_search(p_idea text, p_requirements jsonb, p_mode text, p_notice text, p_model text, p_campaign uuid);
drop function if exists public.set_ai_match_saved(p_search uuid, p_creator uuid, p_saved boolean);
drop function if exists public.ai_match_evidence(p_search uuid, p_creator uuid);
drop function if exists private.creator_embedding_text(p_creator uuid);
drop function if exists public.store_creator_embedding(p_creator uuid, p_embedding text, p_model text, p_hash text, p_queued_at timestamp with time zone);

-- 2. 0022 functions (the legacy RPCs 0024 dropped, and every function 0023 replaced)
CREATE OR REPLACE FUNCTION public.send_final_proposal(p_conversation uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
revoke all on function public.send_final_proposal(p_conversation uuid, p_note text) from public, anon, authenticated, service_role;
grant execute on function public.send_final_proposal(p_conversation uuid, p_note text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.invite_creator(p_campaign uuid, p_creator uuid, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_me uuid := private.assert_active(); v_c public.campaigns;
begin
  select * into v_c from public.campaigns where id = p_campaign and brand_id = v_me;
  if not found then raise exception 'Campaign not found' using errcode = '42501'; end if;
  if v_c.status <> 'active' then raise exception 'Publish the brief before inviting creators' using errcode = '23514'; end if;
  if not exists (select 1 from public.profiles where id = p_creator and role = 'creator' and not is_suspended) then
    raise exception 'Creator not found';
  end if;
  if exists (select 1 from public.notifications where user_id = p_creator and type = 'opportunity'
             and entity_id = p_campaign and (data->>'invited')::boolean) then
    return false;
  end if;
  perform public.notify(p_creator, v_me, 'opportunity', 'campaign', p_campaign,
    jsonb_build_object('campaign_title', v_c.title, 'invited', true, 'note', left(nullif(trim(p_note), ''), 300)));
  insert into public.interactions (user_id, target_type, target_id, action, weight, context)
  values (v_me, 'profile', p_creator, 'contact', 2, jsonb_build_object('campaign_id', p_campaign, 'invite', true));
  return true;
end $function$;
revoke all on function public.invite_creator(p_campaign uuid, p_creator uuid, p_note text) from public, anon, authenticated, service_role;
grant execute on function public.invite_creator(p_campaign uuid, p_creator uuid, p_note text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_proposal(p_proposal uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
revoke all on function public.reject_proposal(p_proposal uuid, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.reject_proposal(p_proposal uuid, p_reason text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hire_creator(p_proposal uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

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
                          and (x.status in ('hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved')
                               or (c.is_sprint and x.status in ('applied', 'shortlisted') and c.sprint_deadline > now()))),
    'revisions_requested', (select count(*) from public.campaign_creators where creator_id = auth.uid() and status = 'revision_requested'),
    'saved_opportunities', (select count(*) from public.saved_opportunities where creator_id = auth.uid()),
    'profile_views', (select count(*) from public.interactions
                      where target_type = 'profile' and target_id = auth.uid() and action = 'view'),
    'brand_interest', (select count(distinct i.user_id) from public.interactions i
                       join public.profiles p on p.id = i.user_id and p.role = 'brand'
                       where i.target_type = 'profile' and i.target_id = auth.uid()
                         and i.action in ('swipe_right', 'contact', 'shortlist')));
$function$;

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
$function$;

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
end $function$;

CREATE OR REPLACE FUNCTION public.is_campaign_collaborator(p_campaign uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.campaign_creators x where x.campaign_id = p_campaign and x.creator_id = p_user
                 and x.hired_at is not null and x.status not in ('cancelled', 'rejected'));
$function$;

CREATE OR REPLACE FUNCTION public.create_campaign_task(p_campaign uuid, p_title text, p_description text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_assignee uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.get_negotiation(p_conversation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

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
$function$;

CREATE OR REPLACE FUNCTION private.terms_label(p_price integer, p_currency text, p_terms jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select private.money(p_price, p_currency)
    || coalesce(' · due ' || to_char((p_terms->>'deadline')::date, 'Mon DD, YYYY'), '')
    || ' · ' || coalesce(p_terms->>'revisions', '0') || ' revision' || case when coalesce(p_terms->>'revisions', '0') = '1' then '' else 's' end
    || ' · ' || left(coalesce(p_terms->>'deliverables', ''), 120);
$function$;

drop function public.accept_offer(p_message uuid);
CREATE OR REPLACE FUNCTION public.accept_offer(p_message uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
revoke all on function public.accept_offer(p_message uuid) from public, anon, authenticated, service_role;
grant execute on function public.accept_offer(p_message uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_campaign_pipeline(p_campaign uuid)
 RETURNS TABLE(creator jsonb, stage text, note text, created_at timestamp with time zone, applied boolean, added_while_draft boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.sync_campaign_group(p_campaign uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION private.clean_terms(p_terms jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.get_campaign_collaborators(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.unhire_creator(p_campaign uuid, p_creator uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.send_offer(p_conversation uuid, p_price integer, p_terms jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

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
$function$;

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
$function$;

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
                                 when 'in_progress' then 3 when 'hired' then 3 when 'shortlisted' then 2 when 'applied' then 1 else 0 end
            from public.campaign_creators x where x.campaign_id = p_campaign and x.creator_id = p.creator_id) desc nulls last;
$function$;

-- 3. Views
create or replace view public.campaign_stats with (security_invoker=true) as
 SELECT id AS campaign_id,
    (( SELECT count(*) AS count
           FROM campaign_applications a
          WHERE ((a.campaign_id = c.id) AND (a.status <> 'withdrawn'::text))))::integer AS applications_count,
    (( SELECT count(*) AS count
           FROM campaign_shortlists s
          WHERE (s.campaign_id = c.id)))::integer AS shortlisted_count,
    (( SELECT count(*) AS count
           FROM campaign_creators x
          WHERE ((x.campaign_id = c.id) AND (x.hired_at IS NOT NULL) AND (x.status <> ALL (ARRAY['cancelled'::text, 'rejected'::text])))))::integer AS selected_count
   FROM campaigns c;

-- 4. Data back to 0022 semantics (quietly: no project events, notifications or transition checks)
alter table public.campaign_creators disable trigger campaign_creators_status_event;
alter table public.campaign_creators disable trigger campaign_creators_transition;
update public.campaign_creators set status = 'hired' where status = 'awaiting_funding';
alter table public.campaign_creators enable trigger campaign_creators_transition;
alter table public.campaign_creators enable trigger campaign_creators_status_event;
update public.proposals p set status = 'sent', decided_at = null
where p.status = 'accepted' and not private.is_hired(p.campaign_id, p.creator_id);

-- 5. Constraints
alter table public.campaign_creators drop constraint campaign_creators_status_check;
alter table public.campaign_creators add constraint campaign_creators_status_check CHECK ((status = ANY (ARRAY['applied'::text, 'shortlisted'::text, 'hired'::text, 'in_progress'::text, 'submitted'::text, 'revision_requested'::text, 'resubmitted'::text, 'approved'::text, 'completed'::text, 'rejected'::text, 'cancelled'::text])));
alter table public.campaign_creators drop constraint campaign_creators_hired_check;
alter table public.campaign_creators add constraint campaign_creators_hired_check CHECK (((status <> ALL (ARRAY['hired'::text, 'in_progress'::text, 'approved'::text, 'completed'::text])) OR (hired_at IS NOT NULL)));

-- 6. Let the migration runner apply 0023 / 0024 again later
do $do$ begin
  if to_regclass('private.schema_migrations') is not null then
    delete from private.schema_migrations where name in ('0023_accept_hire_funding_ai_finder.sql', '0024_accept_hire_funding_cleanup.sql');
  end if;
end $do$;
notify pgrst, 'reload schema';
