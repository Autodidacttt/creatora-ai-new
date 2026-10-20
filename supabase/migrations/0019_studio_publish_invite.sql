-- 0019: Campaign Studio — publishing notifies the best-matching creators; brands can invite a creator to a brief.

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in
  ('follow', 'like', 'comment', 'application', 'shortlisted', 'selected', 'message', 'verification', 'project', 'payment',
   'opportunity'));

-- Publishes a draft and notifies up to 12 creators whose relevance score is at least 35/100.
-- Returns how many creators were notified.
create or replace function public.publish_campaign(p_campaign uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := private.assert_active();
  v_c public.campaigns;
  v_n int := 0;
  r record;
begin
  select * into v_c from public.campaigns where id = p_campaign and brand_id = v_me for update;
  if not found then raise exception 'Campaign not found' using errcode = '42501'; end if;
  if cardinality(v_c.aspect_ratios) = 0 then raise exception 'Pick at least one format before publishing' using errcode = '23514'; end if;
  if cardinality(v_c.usage_rights) = 0 then raise exception 'Pick at least one usage right before publishing' using errcode = '23514'; end if;
  if v_c.status <> 'active' then
    update public.campaigns set status = 'active' where id = p_campaign;
  end if;

  for r in select (m.creator->>'id')::uuid as creator_id, m.score, m.reasons
           from public.rank_creators_for_campaign(p_campaign, 12, 0) m
           where m.score >= 35
  loop
    if not exists (select 1 from public.notifications
                   where user_id = r.creator_id and type = 'opportunity' and entity_id = p_campaign) then
      perform public.notify(r.creator_id, v_me, 'opportunity', 'campaign', p_campaign,
        jsonb_build_object('campaign_title', v_c.title, 'score', r.score, 'reasons', to_jsonb(r.reasons[1:2]), 'invited', false));
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- A direct invitation (from Studio step 4 or Hiring). One per creator per campaign.
create or replace function public.invite_creator(p_campaign uuid, p_creator uuid, p_note text default null)
returns boolean language plpgsql security definer set search_path = public as $$
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
end $$;

revoke execute on function public.publish_campaign(uuid), public.invite_creator(uuid, uuid, text) from public, anon;
grant execute on function public.publish_campaign(uuid), public.invite_creator(uuid, uuid, text) to authenticated, service_role;
