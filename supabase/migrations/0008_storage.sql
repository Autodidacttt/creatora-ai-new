-- 0008: storage buckets. Public read; users write only inside "<their uid>/..."

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880,
     array['image/png','image/jpeg','image/webp','image/gif']),
  ('post-media', 'post-media', true, 52428800,
     array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime']),
  ('campaign-assets', 'campaign-assets', true, 20971520,
     array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "creatora public read" on storage.objects;
drop policy if exists "creatora own folder insert" on storage.objects;
drop policy if exists "creatora own folder update" on storage.objects;
drop policy if exists "creatora own folder delete" on storage.objects;

create policy "creatora public read" on storage.objects for select
  using (bucket_id in ('avatars', 'post-media', 'campaign-assets'));

create policy "creatora own folder insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars', 'post-media', 'campaign-assets')
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "creatora own folder update" on storage.objects for update to authenticated
  using (bucket_id in ('avatars', 'post-media', 'campaign-assets')
         and (storage.foldername(name))[1] = auth.uid()::text)
  with check ((storage.foldername(name))[1] = auth.uid()::text);

create policy "creatora own folder delete" on storage.objects for delete to authenticated
  using (bucket_id in ('avatars', 'post-media', 'campaign-assets')
         and (storage.foldername(name))[1] = auth.uid()::text);
