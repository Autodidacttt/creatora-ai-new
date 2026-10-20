-- 0011: explicit Data API privileges.
-- Newer Supabase projects no longer auto-grant table privileges to the API roles, and the defaults that
-- do exist hand anon/authenticated TRUNCATE/TRIGGER/REFERENCES (which RLS does not cover).
-- This migration is the single source of truth for what each API role may do; RLS policies (0007)
-- still decide *which rows*.

-- ---------------------------------------------------------------------------
-- Baseline: clients read through RLS; the service role (server-only key) can do everything
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Client writes (each further restricted by RLS)
-- ---------------------------------------------------------------------------
-- Profiles: only safe columns. role / is_verified / is_suspended change via /api/admin (service role).
grant update (username, display_name, avatar_url, cover_url, headline, bio, location, website, links, onboarded)
  on public.profiles to authenticated;
grant update on public.creator_details, public.brand_details to authenticated;

-- Creator attributes and past work (upserts need update)
grant insert, update, delete on
  public.creator_skills, public.creator_tools, public.creator_categories, public.creator_content_types,
  public.creator_styles, public.creator_languages, public.creator_platforms, public.creator_experiences
  to authenticated;

-- Portfolio: counters and moderation flags are never client-writable
grant insert, delete on public.posts to authenticated;
grant update (title, description, media_type, media_url, thumbnail_url, source_link, embed_provider,
              content_type_id, style_id, category_id, aspect_ratio, commercial_use_cleared,
              workflow_notes, workflow_steps)
  on public.posts to authenticated;
grant insert, delete on public.post_tools, public.likes, public.saves, public.comments, public.follows to authenticated;

-- Briefs and pipeline
grant insert, update, delete on
  public.campaigns, public.campaign_platforms, public.campaign_tools, public.campaign_skills,
  public.campaign_languages, public.campaign_shortlists, public.campaign_creators, public.saved_opportunities
  to authenticated;
grant insert on public.campaign_applications to authenticated;
grant update (pitch, proposed_rate, status) on public.campaign_applications to authenticated;

-- Messaging: conversations are created only by get_or_create_dm()
grant insert on public.messages to authenticated;
grant update (last_read_at) on public.conversation_participants to authenticated;

-- Signals, notifications, trust
grant insert, delete on public.interactions to authenticated;
grant update (read_at), delete on public.notifications to authenticated;
grant insert, delete on public.verifications to authenticated;
grant insert on public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- Functions: internal helpers stay locked; the service role can run maintenance
-- ---------------------------------------------------------------------------
grant execute on function public.recompute_stats() to service_role;
grant execute on function public.notify(uuid, uuid, text, text, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Defaults for tables/functions created by future migrations
-- (new tables still need RLS enabled + explicit write grants, like above)
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public grant select on tables to anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
