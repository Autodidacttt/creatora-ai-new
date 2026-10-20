-- 0012: Supabase runs pg_safeupdate for API requests, which rejects UPDATEs without a WHERE clause.
-- Redefine the full-table counter rebuild with explicit (always-true) predicates.

create or replace function public.recompute_stats()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.posts p set
    likes_count = (select count(*) from public.likes l where l.post_id = p.id),
    saves_count = (select count(*) from public.saves s where s.post_id = p.id),
    comments_count = (select count(*) from public.comments c where c.post_id = p.id)
  where p.id is not null;

  insert into public.profile_stats (profile_id)
    select id from public.profiles on conflict (profile_id) do nothing;

  update public.profile_stats ps set
    followers_count = (select count(*) from public.follows f where f.following_id = ps.profile_id),
    following_count = (select count(*) from public.follows f where f.follower_id = ps.profile_id),
    posts_count = (select count(*) from public.posts p where p.creator_id = ps.profile_id),
    likes_received_count = (select count(*) from public.likes l
                              join public.posts p on p.id = l.post_id
                              where p.creator_id = ps.profile_id),
    updated_at = now()
  where ps.profile_id is not null;
end $$;

revoke execute on function public.recompute_stats() from public, anon, authenticated;
grant execute on function public.recompute_stats() to service_role;
