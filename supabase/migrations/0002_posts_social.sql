-- 0002: portfolio posts and social graph

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 2000),
  media_type text not null check (media_type in ('image','video','embed')),
  media_url text check (char_length(media_url) <= 1000),
  thumbnail_url text check (char_length(thumbnail_url) <= 1000),
  source_link text check (char_length(source_link) <= 1000),
  embed_provider text check (embed_provider in ('youtube','vimeo','instagram','behance','tiktok','other')),
  content_type_id int references public.content_types(id) on delete set null,
  style_id int references public.styles(id) on delete set null,
  category_id int references public.categories(id) on delete set null,
  aspect_ratio text not null default '16:9'
    check (aspect_ratio in ('16:9','9:16','1:1','4:5','4:3','21:9','custom')),
  commercial_use_cleared boolean not null default false,
  workflow_notes text check (char_length(workflow_notes) <= 2000),
  -- ordered pipeline, e.g. [{"tool_id": 3, "step": "Key frames"}, ...]
  workflow_steps jsonb not null default '[]'::jsonb check (jsonb_typeof(workflow_steps) = 'array'),
  likes_count int not null default 0 check (likes_count >= 0),
  comments_count int not null default 0 check (comments_count >= 0),
  saves_count int not null default 0 check (saves_count >= 0),
  is_removed boolean not null default false,
  search tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(workflow_notes, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (media_url is not null or source_link is not null)
);
create index posts_creator_idx on public.posts(creator_id, created_at desc);
create index posts_created_idx on public.posts(created_at desc) where not is_removed;
create index posts_content_type_idx on public.posts(content_type_id);
create index posts_style_idx on public.posts(style_id);
create index posts_category_idx on public.posts(category_id);
create index posts_aspect_idx on public.posts(aspect_ratio);
create index posts_search_idx on public.posts using gin(search);

create table public.post_tools (
  post_id uuid not null references public.posts(id) on delete cascade,
  tool_id int not null references public.ai_tools(id) on delete cascade,
  primary key (post_id, tool_id)
);
create index post_tools_tool_idx on public.post_tools(tool_id);

create table public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index likes_post_idx on public.likes(post_id);

create table public.saves (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index saves_post_idx on public.saves(post_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments(post_id, created_at);

create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index follows_following_idx on public.follows(following_id);
