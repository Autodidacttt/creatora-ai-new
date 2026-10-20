-- 0005: helper functions, signup bootstrap, counters, guards, notifications

-- ---------------------------------------------------------------------------
-- Auth helpers (security definer so they can be used inside RLS policies
-- without recursive policy evaluation)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and not is_suspended
  );
$$;

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and not is_suspended;
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and not is_suspended);
$$;

create or replace function public.is_participant(p_conversation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation and user_id = auth.uid()
  );
$$;

create or replace function public.owns_campaign(p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campaigns where id = p_campaign and brand_id = auth.uid());
$$;

-- True when the statement runs as an end user through the Data API
-- (as opposed to the service role, migrations or security definer code).
create or replace function public.is_end_user_session()
returns boolean language sql stable as $$
  select current_user in ('authenticated', 'anon');
$$;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger creator_details_touch before update on public.creator_details
  for each row execute function public.touch_updated_at();
create trigger brand_details_touch before update on public.brand_details
  for each row execute function public.touch_updated_at();
create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();
create trigger campaigns_touch before update on public.campaigns
  for each row execute function public.touch_updated_at();
create trigger campaign_applications_touch before update on public.campaign_applications
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Signup bootstrap: every new auth user gets an empty profile of their role.
-- Admin can never be self-assigned; it is granted with the service role.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'creator');
  v_name text := nullif(trim(new.raw_user_meta_data->>'display_name'), '');
  v_base text;
  v_username text;
  v_i int := 0;
begin
  if v_role not in ('creator', 'brand') then
    v_role := 'creator';
  end if;

  v_base := lower(regexp_replace(
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1), 'user'),
    '[^a-zA-Z0-9_.]', '', 'g'));
  if char_length(v_base) < 3 then
    v_base := v_base || 'user';
  end if;
  v_base := left(v_base, 24);
  v_username := v_base;
  while exists (select 1 from public.profiles where username = v_username) loop
    v_i := v_i + 1;
    v_username := v_base || v_i::text;
  end loop;

  insert into public.profiles (id, role, username, display_name)
  values (new.id, v_role, v_username, coalesce(left(v_name, 80), v_username));

  insert into public.profile_stats (profile_id) values (new.id);

  if v_role = 'creator' then
    insert into public.creator_details (profile_id) values (new.id);
  else
    insert into public.brand_details (profile_id, company_name)
    values (new.id, coalesce(left(v_name, 120), v_username));
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Counters
-- ---------------------------------------------------------------------------
create or replace function public.tg_follows_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profile_stats set followers_count = followers_count + 1, updated_at = now()
      where profile_id = new.following_id;
    update public.profile_stats set following_count = following_count + 1, updated_at = now()
      where profile_id = new.follower_id;
  else
    update public.profile_stats set followers_count = greatest(followers_count - 1, 0), updated_at = now()
      where profile_id = old.following_id;
    update public.profile_stats set following_count = greatest(following_count - 1, 0), updated_at = now()
      where profile_id = old.follower_id;
  end if;
  return null;
end $$;
create trigger follows_counts after insert or delete on public.follows
  for each row execute function public.tg_follows_counts();

create or replace function public.tg_likes_counts()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_post uuid := coalesce(new.post_id, old.post_id);
  v_delta int := case when tg_op = 'INSERT' then 1 else -1 end;
  v_creator uuid;
begin
  update public.posts set likes_count = greatest(likes_count + v_delta, 0)
    where id = v_post returning creator_id into v_creator;
  if v_creator is not null then
    update public.profile_stats
      set likes_received_count = greatest(likes_received_count + v_delta, 0), updated_at = now()
      where profile_id = v_creator;
  end if;
  return null;
end $$;
create trigger likes_counts after insert or delete on public.likes
  for each row execute function public.tg_likes_counts();

create or replace function public.tg_saves_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.posts
    set saves_count = greatest(saves_count + case when tg_op = 'INSERT' then 1 else -1 end, 0)
    where id = coalesce(new.post_id, old.post_id);
  return null;
end $$;
create trigger saves_counts after insert or delete on public.saves
  for each row execute function public.tg_saves_counts();

create or replace function public.tg_comments_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.posts
    set comments_count = greatest(comments_count + case when tg_op = 'INSERT' then 1 else -1 end, 0)
    where id = coalesce(new.post_id, old.post_id);
  return null;
end $$;
create trigger comments_counts after insert or delete on public.comments
  for each row execute function public.tg_comments_counts();

create or replace function public.tg_posts_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profile_stats set posts_count = posts_count + 1, updated_at = now()
      where profile_id = new.creator_id;
  elsif tg_op = 'DELETE' then
    update public.profile_stats
      set posts_count = greatest(posts_count - 1, 0),
          likes_received_count = greatest(likes_received_count - old.likes_count, 0),
          updated_at = now()
      where profile_id = old.creator_id;
  end if;
  return null;
end $$;
create trigger posts_counts after insert or delete on public.posts
  for each row execute function public.tg_posts_counts();

-- Rebuild every counter from source rows (used by the seed script and admin tools)
create or replace function public.recompute_stats()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.posts p set
    likes_count = (select count(*) from public.likes l where l.post_id = p.id),
    saves_count = (select count(*) from public.saves s where s.post_id = p.id),
    comments_count = (select count(*) from public.comments c where c.post_id = p.id);

  insert into public.profile_stats (profile_id)
    select id from public.profiles on conflict (profile_id) do nothing;

  update public.profile_stats ps set
    followers_count = (select count(*) from public.follows f where f.following_id = ps.profile_id),
    following_count = (select count(*) from public.follows f where f.follower_id = ps.profile_id),
    posts_count = (select count(*) from public.posts p where p.creator_id = ps.profile_id),
    likes_received_count = (select count(*) from public.likes l
                              join public.posts p on p.id = l.post_id
                              where p.creator_id = ps.profile_id),
    updated_at = now();
end $$;
revoke execute on function public.recompute_stats() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guards: end users can never set counters or moderation/verification state
-- ---------------------------------------------------------------------------
create or replace function public.tg_posts_guard()
returns trigger language plpgsql as $$
begin
  if public.is_end_user_session() then
    if tg_op = 'INSERT' then
      new.likes_count := 0;
      new.comments_count := 0;
      new.saves_count := 0;
      new.is_removed := false;
    end if;
  end if;
  return new;
end $$;
create trigger posts_guard before insert on public.posts
  for each row execute function public.tg_posts_guard();

create or replace function public.tg_verifications_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'tool' and not exists (
      select 1 from public.creator_tools where creator_id = new.creator_id and tool_id = new.tool_id) then
    raise exception 'Tool verification must reference a tool in the creator''s stack';
  end if;
  if new.type = 'workflow' and not exists (
      select 1 from public.posts where id = new.post_id and creator_id = new.creator_id) then
    raise exception 'Workflow verification must reference one of the creator''s own posts';
  end if;
  if new.type = 'past_work' and not exists (
      select 1 from public.creator_experiences where id = new.experience_id and creator_id = new.creator_id) then
    raise exception 'Past work verification must reference the creator''s own experience entry';
  end if;
  return new;
end $$;
create trigger verifications_guard before insert or update on public.verifications
  for each row execute function public.tg_verifications_guard();

-- Separate invoker-rights guard so current_user reflects the real caller
create or replace function public.tg_verifications_status_guard()
returns trigger language plpgsql as $$
begin
  if public.is_end_user_session() and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.status := 'pending';
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.review_notes := null;
    else
      raise exception 'Only admins can review verifications';
    end if;
  end if;
  return new;
end $$;
create trigger verifications_status_guard before insert or update on public.verifications
  for each row execute function public.tg_verifications_status_guard();

create or replace function public.tg_applications_guard()
returns trigger language plpgsql as $$
begin
  if not public.is_end_user_session() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    if not exists (select 1 from public.campaigns where id = new.campaign_id and status = 'active') then
      raise exception 'You can only apply to active campaigns';
    end if;
    return new;
  end if;
  -- UPDATE
  if auth.uid() = old.creator_id then
    if new.status not in ('pending', 'withdrawn') then
      raise exception 'Creators can only withdraw or re-open their application';
    end if;
  elsif public.owns_campaign(old.campaign_id) then
    if new.pitch is distinct from old.pitch or new.proposed_rate is distinct from old.proposed_rate then
      raise exception 'Brands cannot edit an application pitch';
    end if;
    if new.status not in ('pending', 'rejected') then
      raise exception 'Brands can only reject or restore an application';
    end if;
  else
    raise exception 'Not allowed';
  end if;
  return new;
end $$;
create trigger applications_guard before insert or update on public.campaign_applications
  for each row execute function public.tg_applications_guard();

create or replace function public.tg_campaigns_publish()
returns trigger language plpgsql as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end $$;
create trigger campaigns_publish before insert or update on public.campaigns
  for each row execute function public.tg_campaigns_publish();

-- ---------------------------------------------------------------------------
-- Messaging bookkeeping
-- ---------------------------------------------------------------------------
create or replace function public.tg_messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
    set last_message_at = new.created_at,
        last_message_preview = left(new.body, 140),
        last_sender_id = new.sender_id
    where id = new.conversation_id;
  update public.conversation_participants
    set last_read_at = new.created_at
    where conversation_id = new.conversation_id and user_id = new.sender_id;
  return null;
end $$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.tg_messages_after_insert();

-- ---------------------------------------------------------------------------
-- Notifications from real events
-- ---------------------------------------------------------------------------
create or replace function public.notify(
  p_user uuid, p_actor uuid, p_type text, p_entity_type text, p_entity_id uuid, p_data jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then
    return;
  end if;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, data)
  values (p_user, p_actor, p_type, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb));
end $$;
revoke execute on function public.notify(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.tg_notify_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.following_id, new.follower_id, 'follow', 'profile', new.follower_id);
  return null;
end $$;
create trigger notify_follow after insert on public.follows
  for each row execute function public.tg_notify_follow();

create or replace function public.tg_notify_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_post record;
begin
  select creator_id, title into v_post from public.posts where id = new.post_id;
  -- one notification per (actor, post): re-likes after unlike don't spam
  if not exists (select 1 from public.notifications
                 where user_id = v_post.creator_id and actor_id = new.user_id
                   and type = 'like' and entity_id = new.post_id) then
    perform public.notify(v_post.creator_id, new.user_id, 'like', 'post', new.post_id,
      jsonb_build_object('post_title', v_post.title));
  end if;
  return null;
end $$;
create trigger notify_like after insert on public.likes
  for each row execute function public.tg_notify_like();

create or replace function public.tg_notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_post record;
begin
  select creator_id, title into v_post from public.posts where id = new.post_id;
  perform public.notify(v_post.creator_id, new.user_id, 'comment', 'post', new.post_id,
    jsonb_build_object('post_title', v_post.title, 'excerpt', left(new.body, 120)));
  return null;
end $$;
create trigger notify_comment after insert on public.comments
  for each row execute function public.tg_notify_comment();

create or replace function public.tg_notify_application()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_c record;
begin
  select brand_id, title into v_c from public.campaigns where id = new.campaign_id;
  perform public.notify(v_c.brand_id, new.creator_id, 'application', 'campaign', new.campaign_id,
    jsonb_build_object('campaign_title', v_c.title, 'application_id', new.id));
  return null;
end $$;
create trigger notify_application after insert on public.campaign_applications
  for each row execute function public.tg_notify_application();

create or replace function public.tg_notify_shortlist()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_c record;
begin
  select brand_id, title into v_c from public.campaigns where id = new.campaign_id;
  perform public.notify(new.creator_id, v_c.brand_id, 'shortlisted', 'campaign', new.campaign_id,
    jsonb_build_object('campaign_title', v_c.title));
  return null;
end $$;
create trigger notify_shortlist after insert on public.campaign_shortlists
  for each row execute function public.tg_notify_shortlist();

create or replace function public.tg_notify_selected()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_c record;
begin
  select brand_id, title into v_c from public.campaigns where id = new.campaign_id;
  perform public.notify(new.creator_id, v_c.brand_id, 'selected', 'campaign', new.campaign_id,
    jsonb_build_object('campaign_title', v_c.title));
  return null;
end $$;
create trigger notify_selected after insert on public.campaign_creators
  for each row execute function public.tg_notify_selected();

-- Collapse message notifications: one unread notification per conversation per user
create or replace function public.tg_notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
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
create trigger notify_message after insert on public.messages
  for each row execute function public.tg_notify_message();

create or replace function public.tg_notify_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.notify(new.creator_id, new.reviewed_by, 'verification', 'verification', new.id,
      jsonb_build_object('title', new.title, 'status', new.status, 'type', new.type));
  end if;
  return null;
end $$;
create trigger notify_verification after update on public.verifications
  for each row execute function public.tg_notify_verification();
