-- 0024: contract step of 0023. Apply only after the app built for 0023 is live: the previous app can't render
-- 'awaiting_funding' projects and still calls the RPCs removed here.

-- Legacy hiring and invite RPCs (the current app doesn't call them)
drop function if exists public.send_final_proposal(uuid, text);
drop function if exists public.reject_proposal(uuid, text);
drop function if exists public.invite_creator(uuid, uuid, text);

-- Terms lose "revisions" (stored proposals and offer / proposal cards)
update public.proposals set terms = terms - 'revisions' where terms ? 'revisions';
update public.messages set payload = jsonb_set(payload, '{terms}', (payload->'terms') - 'revisions')
where kind in ('offer', 'proposal') and payload->'terms' ? 'revisions';

-- Hired but never funded → awaiting_funding, quietly: no project events, notifications or "left the group" posts.
-- Includes legacy hires with no fee yet: they agree it in chat, and accepting opens the escrow to fund.
-- They leave the campaign group chat until funded (funding re-adds them through the normal group sync).
alter table public.campaign_creators disable trigger campaign_creators_status_event;
alter table public.campaign_creators disable trigger campaign_creators_group;
create temp table awaiting_backfill (campaign_id uuid, creator_id uuid) on commit drop;
with moved as (
  update public.campaign_creators x set status = 'awaiting_funding'
  where x.status = 'hired' and x.hired_at is not null
    and not exists (select 1 from public.escrow_payments e where e.campaign_creator_id = x.id and e.status <> 'unfunded')
  returning x.campaign_id, x.creator_id)
insert into awaiting_backfill select * from moved;
delete from public.conversation_participants cp
using public.conversations g, awaiting_backfill a
where g.id = cp.conversation_id and g.type = 'group' and g.campaign_id = a.campaign_id and cp.user_id = a.creator_id;
alter table public.campaign_creators enable trigger campaign_creators_group;
alter table public.campaign_creators enable trigger campaign_creators_status_event;
