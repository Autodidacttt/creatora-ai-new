-- 0009: controlled vocabulary for filters, briefs and profiles (not demo data)

insert into public.ai_tools (slug, name, category, vendor, sort) values
  ('midjourney', 'Midjourney', 'image', 'Midjourney', 10),
  ('flux', 'FLUX', 'image', 'Black Forest Labs', 11),
  ('stable-diffusion', 'Stable Diffusion', 'image', 'Stability AI', 12),
  ('dall-e', 'DALL·E / GPT Image', 'image', 'OpenAI', 13),
  ('adobe-firefly', 'Adobe Firefly', 'image', 'Adobe', 14),
  ('ideogram', 'Ideogram', 'image', 'Ideogram', 15),
  ('leonardo', 'Leonardo AI', 'image', 'Leonardo', 16),
  ('krea', 'Krea', 'image', 'Krea', 17),
  ('magnific', 'Magnific', 'image', 'Magnific', 18),
  ('comfyui', 'ComfyUI', 'image', 'Open source', 19),
  ('runway', 'Runway', 'video', 'Runway', 20),
  ('sora', 'Sora', 'video', 'OpenAI', 21),
  ('veo', 'Google Veo', 'video', 'Google', 22),
  ('kling', 'Kling', 'video', 'Kuaishou', 23),
  ('luma', 'Luma Dream Machine', 'video', 'Luma AI', 24),
  ('pika', 'Pika', 'video', 'Pika', 25),
  ('hailuo', 'Hailuo / MiniMax', 'video', 'MiniMax', 26),
  ('topaz', 'Topaz Video AI', 'video', 'Topaz Labs', 27),
  ('wonder-studio', 'Wonder Studio', 'video', 'Autodesk', 28),
  ('elevenlabs', 'ElevenLabs', 'audio', 'ElevenLabs', 30),
  ('suno', 'Suno', 'audio', 'Suno', 31),
  ('udio', 'Udio', 'audio', 'Udio', 32),
  ('blender', 'Blender', '3d', 'Blender Foundation', 40),
  ('unreal', 'Unreal Engine', '3d', 'Epic Games', 41),
  ('cinema4d', 'Cinema 4D', '3d', 'Maxon', 42),
  ('meshy', 'Meshy', '3d', 'Meshy', 43),
  ('spline', 'Spline', '3d', 'Spline', 44),
  ('after-effects', 'After Effects', 'editing', 'Adobe', 50),
  ('davinci', 'DaVinci Resolve', 'editing', 'Blackmagic', 51),
  ('premiere', 'Premiere Pro', 'editing', 'Adobe', 52),
  ('photoshop', 'Photoshop', 'editing', 'Adobe', 53),
  ('capcut', 'CapCut', 'editing', 'ByteDance', 54),
  ('chatgpt', 'ChatGPT', 'llm', 'OpenAI', 60),
  ('claude', 'Claude', 'llm', 'Anthropic', 61),
  ('gemini', 'Gemini', 'llm', 'Google', 62),
  ('heygen', 'HeyGen', 'avatar', 'HeyGen', 70),
  ('synthesia', 'Synthesia', 'avatar', 'Synthesia', 71)
on conflict (slug) do update set name = excluded.name, category = excluded.category,
  vendor = excluded.vendor, sort = excluded.sort;

insert into public.skills (slug, name, sort) values
  ('prompt-engineering', 'Prompt engineering', 1),
  ('art-direction', 'Art direction', 2),
  ('storyboarding', 'Storyboarding', 3),
  ('scriptwriting', 'Scriptwriting', 4),
  ('character-consistency', 'Character consistency', 5),
  ('lora-training', 'LoRA / model fine-tuning', 6),
  ('comfyui-pipelines', 'Node-based pipelines', 7),
  ('compositing', 'Compositing', 8),
  ('vfx', 'VFX', 9),
  ('motion-design', 'Motion design', 10),
  ('3d-modeling', '3D modeling', 11),
  ('3d-animation', '3D animation', 12),
  ('video-editing', 'Video editing', 13),
  ('color-grading', 'Color grading', 14),
  ('sound-design', 'Sound design', 15),
  ('music-production', 'Music production', 16),
  ('upscaling', 'Upscaling & restoration', 17),
  ('lip-sync', 'Lip-sync & avatars', 18),
  ('product-viz', 'Product visualization', 19),
  ('typography', 'Kinetic typography', 20)
on conflict (slug) do update set name = excluded.name, sort = excluded.sort;

insert into public.categories (slug, name, description, sort) values
  ('ai-film', 'AI film & narrative', 'Short films, trailers and story-driven pieces', 1),
  ('fashion', 'Fashion & beauty visuals', 'Lookbooks, campaigns and editorial imagery', 2),
  ('3d-animation', '3D animation', 'Characters, worlds and product animation in 3D', 3),
  ('motion-design', 'Motion design', 'Brand motion, kinetic type and explainers', 4),
  ('music-video', 'Music video visuals', 'Music videos, visualizers and tour visuals', 5),
  ('product-ads', 'Product & commercial ads', 'Performance and hero ads for products', 6),
  ('character-avatar', 'Characters & avatars', 'Virtual influencers, mascots and spokespeople', 7),
  ('architecture', 'Architecture & spaces', 'Interiors, real estate and spatial concepts', 8),
  ('gaming', 'Gaming & worldbuilding', 'Key art, cinematics and environments', 9),
  ('social-ugc', 'Social content & UGC', 'Native short-form content for social', 10)
on conflict (slug) do update set name = excluded.name, description = excluded.description, sort = excluded.sort;

insert into public.content_types (slug, name, sort) values
  ('short-video', 'Short-form video', 1),
  ('film', 'Short film', 2),
  ('music-video', 'Music video', 3),
  ('key-visual', 'Key visuals & stills', 4),
  ('product-ad', 'Product ad', 5),
  ('animation-2d', '2D animation', 6),
  ('animation-3d', '3D animation', 7),
  ('lookbook', 'Lookbook / editorial', 8),
  ('explainer', 'Explainer video', 9),
  ('avatar-video', 'Avatar / spokesperson video', 10),
  ('visualizer', 'Visualizer / loop', 11)
on conflict (slug) do update set name = excluded.name, sort = excluded.sort;

insert into public.styles (slug, name, sort) values
  ('cinematic', 'Cinematic', 1),
  ('photoreal', 'Photorealistic', 2),
  ('editorial', 'Editorial', 3),
  ('surreal', 'Surreal', 4),
  ('minimal', 'Minimal', 5),
  ('anime', 'Anime', 6),
  ('retro', 'Retro / Y2K', 7),
  ('cyberpunk', 'Cyberpunk', 8),
  ('claymation', 'Claymation', 9),
  ('painterly', 'Painterly', 10),
  ('documentary', 'Documentary', 11),
  ('abstract', 'Abstract', 12)
on conflict (slug) do update set name = excluded.name, sort = excluded.sort;

insert into public.platforms (slug, name, sort) values
  ('instagram', 'Instagram', 1),
  ('tiktok', 'TikTok', 2),
  ('youtube', 'YouTube', 3),
  ('youtube-shorts', 'YouTube Shorts', 4),
  ('linkedin', 'LinkedIn', 5),
  ('x', 'X', 6),
  ('pinterest', 'Pinterest', 7),
  ('snapchat', 'Snapchat', 8),
  ('ctv', 'Connected TV', 9),
  ('dooh', 'Digital out-of-home', 10),
  ('web', 'Website', 11)
on conflict (slug) do update set name = excluded.name, sort = excluded.sort;

insert into public.languages (slug, name, sort) values
  ('en', 'English', 1),
  ('es', 'Spanish', 2),
  ('fr', 'French', 3),
  ('de', 'German', 4),
  ('pt', 'Portuguese', 5),
  ('it', 'Italian', 6),
  ('hi', 'Hindi', 7),
  ('ja', 'Japanese', 8),
  ('ko', 'Korean', 9),
  ('zh', 'Mandarin', 10),
  ('ar', 'Arabic', 11),
  ('ne', 'Nepali', 12)
on conflict (slug) do update set name = excluded.name, sort = excluded.sort;
