# Data model note

Creatora runs on Supabase Postgres. Every table has row-level security (RLS). Counters and notifications are kept by triggers, never by the client. Matching, search and the feed are SQL functions.

## Creator profile

| Table | Key fields | Purpose |
|---|---|---|
| `profiles` | `id` (= auth user), `role` (creator / brand / admin), `username`, `display_name`, `avatar_url`, `cover_url`, `headline`, `bio`, `location`, `website`, `links` (jsonb), `is_verified`, `is_suspended`, full-text `search` | Public identity. Role, verification and suspension can't be written by users. |
| `profile_stats` | `followers_count`, `following_count`, `posts_count`, `likes_received_count` | Maintained by triggers. Users can read it but can't write it. |
| `creator_details` | `experience_level` (emerging → expert), `availability` (open / limited / booked), `years_experience`, `rate_min`, `rate_max`, `currency`, `workflow_overview` | Creator-specific attributes |
| `creator_tools` | `tool_id`, `proficiency` (learning / proficient / expert) | **AI tools and models** the creator uses |
| `creator_skills`, `creator_categories`, `creator_content_types`, `creator_styles`, `creator_languages`, `creator_platforms` | lookup ids | Skills, specialisations, formats, styles, languages and platforms. Each is filterable. |
| `creator_experiences` | `brand_name`, `project_title`, `year`, `description`, `link` | Past brand and campaign work |
| `verifications` | `type` (tool / workflow / past_work / identity), plus `tool_id`, `post_id` or `experience_id`, `evidence_url`, `evidence_notes`, `status`, `reviewed_by`, `reviewed_at` | Trust signals. Each badge shows *what* was verified and *how*. |

Lookup tables (`ai_tools` with category, `skills`, `categories`, `content_types`, `styles`, `platforms`, `languages`) drive every filter and form option.

## AI portfolio

| Table | Key fields |
|---|---|
| `posts` | `media_type` (image / video / embed), `media_url` (Storage upload) or `source_link` + `embed_provider` (YouTube, Vimeo, Instagram, TikTok, Behance), `thumbnail_url`, `title`, `description`, `content_type_id`, `style_id`, `category_id`, `aspect_ratio` (16:9, 9:16, 1:1, 4:5, 4:3, 21:9, custom), **`commercial_use_cleared`**, **`workflow_notes`**, **`workflow_steps`** (ordered `[{tool_id, step}]`, e.g. Midjourney → Runway → DaVinci), trigger-maintained like, comment and save counts |
| `post_tools` | The AI tools and models used for each piece |
| `likes`, `saves`, `comments`, `follows` | One row per user and target. Unique keys stop duplicates. |

## Brief / campaign

| Field group | Fields on `campaigns` (+ join tables) |
|---|---|
| Basics | `title`, `description`, `deliverables`, `status` (draft → active → completed), `published_at`, `ai_assisted` |
| Content & format | `content_type_id`, `style_id`, `category_id`, **`aspect_ratios`** (array), `custom_aspect`, `campaign_platforms` |
| Requirements | `campaign_tools`, `campaign_skills`, `campaign_languages`, `creators_needed` |
| Audience, budget, timing | `target_audience`, `budget_min`, `budget_max`, `currency`, `deadline` |
| **Commercial use** | **`usage_rights`** (organic social, paid social, broadcast, out-of-home, web, internal), **`territory`**, **`usage_duration`** (3 months → perpetual), **`exclusivity`** (none / category / full), **`license_type`** (non-exclusive / exclusive / limited / buyout), **`ai_disclosure_required`** |

The pipeline runs through three tables: `campaign_applications` (pitch, proposed fee, status), `campaign_shortlists` and `campaign_creators` (selected or completed). The `campaign_stats` view computes the counts. Creators keep `saved_opportunities`. Each "Not for me" is recorded as an `interactions` row.

## Signals, messaging and moderation

- **`interactions`:** view, like, save, follow, swipe left or right, contact, ignore, apply and shortlist, each with a weight. These feed the swipe deck (already-swiped creators are excluded) and the home feed.
- **Messaging:** `conversations`, `conversation_participants` (read markers) and `messages`, with Realtime enabled.
- **Notifications:** created by triggers.
- **Moderation:** `reports` and `audit_logs`.

## Matching (relevance, not talent)

`rank_creators_for_campaign` scores each creator from 0 to 100 using these weights:

| Factor | Weight |
|---|---|
| Tool overlap | 25 |
| Portfolio relevance (posts matching content type, style, category, format or tools) | 25 |
| Skill overlap | 20 |
| Campaign experience (verified past work counts most) | 10 |
| Platform, language and category fit | 10 |
| Availability | 10 |

If a brief leaves a factor unspecified, that factor scores half. The function returns a per-factor `breakdown` and readable `reasons`, for example "Uses Runway (1/1 required tools)" or "3 portfolio pieces match this brief's format & style".
