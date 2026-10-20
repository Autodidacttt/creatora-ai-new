-- 0007: Row Level Security on every table + column-level write grants

-- Enable RLS everywhere in public
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Lookups: world-readable, written only by migrations / service role
-- ---------------------------------------------------------------------------
create policy "lookups readable" on public.skills for select using (true);
create policy "lookups readable" on public.ai_tools for select using (true);
create policy "lookups readable" on public.categories for select using (true);
create policy "lookups readable" on public.content_types for select using (true);
create policy "lookups readable" on public.styles for select using (true);
create policy "lookups readable" on public.platforms for select using (true);
create policy "lookups readable" on public.languages for select using (true);

-- ---------------------------------------------------------------------------
-- Profiles & details
-- ---------------------------------------------------------------------------
create policy "profiles readable" on public.profiles for select using (true);
create policy "profiles self update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Only safe columns are writable by end users; role / verification / suspension are not.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (username, display_name, avatar_url, cover_url, headline, bio, location, website, links, onboarded)
  on public.profiles to authenticated;

create policy "stats readable" on public.profile_stats for select using (true);
revoke insert, update, delete on public.profile_stats from anon, authenticated;

create policy "creator details readable" on public.creator_details for select using (true);
create policy "creator details self update" on public.creator_details for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
revoke insert, delete on public.creator_details from anon, authenticated;

create policy "brand details readable" on public.brand_details for select using (true);
create policy "brand details self update" on public.brand_details for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
revoke insert, delete on public.brand_details from anon, authenticated;

create policy "experiences readable" on public.creator_experiences for select using (true);
create policy "experiences self insert" on public.creator_experiences for insert to authenticated
  with check (creator_id = auth.uid() and public.current_app_role() = 'creator');
create policy "experiences self update" on public.creator_experiences for update to authenticated
  using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy "experiences self delete" on public.creator_experiences for delete to authenticated
  using (creator_id = auth.uid());

-- Creator attribute joins: same shape for each
do $$
declare t text;
begin
  foreach t in array array['creator_skills','creator_tools','creator_categories','creator_content_types',
                           'creator_styles','creator_languages','creator_platforms'] loop
    execute format('create policy "readable" on public.%I for select using (true)', t);
    execute format('create policy "self insert" on public.%I for insert to authenticated
                      with check (creator_id = auth.uid() and public.current_app_role() = ''creator'')', t);
    execute format('create policy "self update" on public.%I for update to authenticated
                      using (creator_id = auth.uid()) with check (creator_id = auth.uid())', t);
    execute format('create policy "self delete" on public.%I for delete to authenticated
                      using (creator_id = auth.uid())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Posts & social
-- ---------------------------------------------------------------------------
create policy "posts readable" on public.posts for select
  using (not is_removed or creator_id = auth.uid() or public.is_admin());
create policy "posts creator insert" on public.posts for insert to authenticated
  with check (creator_id = auth.uid() and public.current_app_role() = 'creator');
create policy "posts owner update" on public.posts for update to authenticated
  using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy "posts owner delete" on public.posts for delete to authenticated
  using (creator_id = auth.uid());

revoke update on public.posts from anon, authenticated;
grant update (title, description, media_type, media_url, thumbnail_url, source_link, embed_provider,
              content_type_id, style_id, category_id, aspect_ratio, commercial_use_cleared,
              workflow_notes, workflow_steps)
  on public.posts to authenticated;

create policy "post tools readable" on public.post_tools for select using (true);
create policy "post tools owner insert" on public.post_tools for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = post_id and p.creator_id = auth.uid()));
create policy "post tools owner delete" on public.post_tools for delete to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.creator_id = auth.uid()));

create policy "likes readable" on public.likes for select using (true);
create policy "likes self insert" on public.likes for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());
create policy "likes self delete" on public.likes for delete to authenticated using (user_id = auth.uid());

create policy "saves private" on public.saves for select to authenticated using (user_id = auth.uid());
create policy "saves self insert" on public.saves for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());
create policy "saves self delete" on public.saves for delete to authenticated using (user_id = auth.uid());

create policy "comments readable" on public.comments for select using (true);
create policy "comments self insert" on public.comments for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());
create policy "comments delete own or on own post" on public.comments for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.posts p where p.id = post_id and p.creator_id = auth.uid()));
revoke update on public.comments from anon, authenticated;

create policy "follows readable" on public.follows for select using (true);
create policy "follows self insert" on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and public.is_active_user());
create policy "follows self delete" on public.follows for delete to authenticated using (follower_id = auth.uid());
revoke update on public.follows, public.likes, public.saves from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
create policy "campaigns visible" on public.campaigns for select
  using (status <> 'draft' or brand_id = auth.uid() or public.is_admin());
create policy "campaigns brand insert" on public.campaigns for insert to authenticated
  with check (brand_id = auth.uid() and public.current_app_role() = 'brand');
create policy "campaigns brand update" on public.campaigns for update to authenticated
  using (brand_id = auth.uid()) with check (brand_id = auth.uid());
create policy "campaigns brand delete" on public.campaigns for delete to authenticated
  using (brand_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['campaign_platforms','campaign_tools','campaign_skills','campaign_languages'] loop
    execute format('create policy "visible with campaign" on public.%I for select
                      using (exists (select 1 from public.campaigns c where c.id = campaign_id))', t);
    execute format('create policy "owner insert" on public.%I for insert to authenticated
                      with check (public.owns_campaign(campaign_id))', t);
    execute format('create policy "owner delete" on public.%I for delete to authenticated
                      using (public.owns_campaign(campaign_id))', t);
  end loop;
end $$;

create policy "applications visible to applicant and brand" on public.campaign_applications for select
  using (creator_id = auth.uid() or public.owns_campaign(campaign_id) or public.is_admin());
create policy "applications creator insert" on public.campaign_applications for insert to authenticated
  with check (creator_id = auth.uid() and public.current_app_role() = 'creator');
create policy "applications applicant or brand update" on public.campaign_applications for update to authenticated
  using (creator_id = auth.uid() or public.owns_campaign(campaign_id))
  with check (creator_id = auth.uid() or public.owns_campaign(campaign_id));
revoke update on public.campaign_applications from anon, authenticated;
grant update (pitch, proposed_rate, status) on public.campaign_applications to authenticated;
revoke delete on public.campaign_applications from anon, authenticated;

create policy "shortlists visible to brand and creator" on public.campaign_shortlists for select
  using (creator_id = auth.uid() or public.owns_campaign(campaign_id) or public.is_admin());
create policy "shortlists brand insert" on public.campaign_shortlists for insert to authenticated
  with check (public.owns_campaign(campaign_id) and added_by = auth.uid()
              and exists (select 1 from public.profiles p where p.id = creator_id and p.role = 'creator'));
create policy "shortlists brand delete" on public.campaign_shortlists for delete to authenticated
  using (public.owns_campaign(campaign_id));

create policy "selections visible to brand and creator" on public.campaign_creators for select
  using (creator_id = auth.uid() or public.owns_campaign(campaign_id) or public.is_admin());
create policy "selections brand insert" on public.campaign_creators for insert to authenticated
  with check (public.owns_campaign(campaign_id)
              and exists (select 1 from public.profiles p where p.id = creator_id and p.role = 'creator'));
create policy "selections brand update" on public.campaign_creators for update to authenticated
  using (public.owns_campaign(campaign_id)) with check (public.owns_campaign(campaign_id));
create policy "selections brand delete" on public.campaign_creators for delete to authenticated
  using (public.owns_campaign(campaign_id));

create policy "saved opportunities own" on public.saved_opportunities for select to authenticated
  using (creator_id = auth.uid());
create policy "saved opportunities insert" on public.saved_opportunities for insert to authenticated
  with check (creator_id = auth.uid());
create policy "saved opportunities delete" on public.saved_opportunities for delete to authenticated
  using (creator_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Messaging: participants only. Conversations are created via get_or_create_dm().
-- ---------------------------------------------------------------------------
create policy "conversations participants" on public.conversations for select to authenticated
  using (public.is_participant(id));
revoke insert, update, delete on public.conversations from anon, authenticated;

create policy "participants visible to participants" on public.conversation_participants for select to authenticated
  using (public.is_participant(conversation_id));
create policy "participants update own read marker" on public.conversation_participants for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on public.conversation_participants from anon, authenticated;
grant update (last_read_at) on public.conversation_participants to authenticated;

create policy "messages visible to participants" on public.messages for select to authenticated
  using (public.is_participant(conversation_id));
create policy "messages participants insert" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_participant(conversation_id) and public.is_active_user());
revoke update, delete on public.messages from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Signals, notifications
-- ---------------------------------------------------------------------------
create policy "interactions own select" on public.interactions for select to authenticated
  using (user_id = auth.uid());
create policy "interactions own insert" on public.interactions for insert to authenticated
  with check (user_id = auth.uid());
create policy "interactions own delete" on public.interactions for delete to authenticated
  using (user_id = auth.uid());
revoke update on public.interactions from anon, authenticated;

create policy "notifications own select" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notifications own update" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications own delete" on public.notifications for delete to authenticated
  using (user_id = auth.uid());
revoke insert, update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Verification, reports, audit
-- ---------------------------------------------------------------------------
create policy "verifications public when approved" on public.verifications for select
  using (status = 'approved' or creator_id = auth.uid() or public.is_admin());
create policy "verifications creator request" on public.verifications for insert to authenticated
  with check (creator_id = auth.uid() and public.current_app_role() = 'creator');
create policy "verifications creator withdraw pending" on public.verifications for delete to authenticated
  using (creator_id = auth.uid() and status = 'pending');
revoke update on public.verifications from anon, authenticated;

create policy "reports own or admin" on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());
create policy "reports insert" on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());
revoke update, delete on public.reports from anon, authenticated;

create policy "audit admin read" on public.audit_logs for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.audit_logs from anon, authenticated;

-- Lookups are never written by end users
revoke insert, update, delete on public.skills, public.ai_tools, public.categories, public.content_types,
  public.styles, public.platforms, public.languages from anon, authenticated;

-- Anonymous visitors only browse; every write requires a signed-in user.
revoke insert, update, delete on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.messages;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.conversations;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
