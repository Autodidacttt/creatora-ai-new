# Creatora: AI Creator Marketplace

Creatora is a social marketplace where AI filmmakers, animators and generative artists show their work and get hired by brands and agencies.

- **Creators** publish portfolios that show the AI tools, models and workflow behind every piece.
- **Brands** write structured briefs, sometimes drafted by AI from a single sentence. They find creators with precise filters, swipe through ranked matches, shortlist, and hire by negotiating terms in chat and accepting the creator's final proposal.

All data comes from Supabase and every action persists. New accounts start completely empty.

> Also in this repo: [`DATA_MODEL.md`](DATA_MODEL.md) (submission data-model note) · [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) (3-minute demo path)

---

## Recent changes

### 2026-10-24: Accept → Hire → Fund, no revisions / invites, AI Creator Finder

Migrations (rules enforced in RPCs, triggers and RLS), applied in two steps:
- `0023_accept_hire_funding_ai_finder.sql` is the expand step. It is safe while the previous app is still serving: the old "final proposal" buttons get a "refresh the page" message.
- `0024_accept_hire_funding_cleanup.sql` is the contract step, applied after the new app is live. It drops the legacy RPCs, strips stored "revisions", and quietly moves unfunded hires to `awaiting_funding`.
- Rollback: `supabase/rollback/0023_0024_down.sql` (generated from the 0022 schema). It keeps every project, payment, proposal and message, and drops only the AI Finder tables.

**Accepted offer = agreement → Hire.**
- When one side accepts the other's latest offer, the server records an accepted, versioned proposal from it.
- The brand immediately gets a primary **Hire** button in the chat, on the pinned card and on the accepted offer.
- The "creator sends a final proposal" step is gone (`send_final_proposal` and `reject_proposal` were removed).
- A new offer after acceptance voids the agreement.
- `hire_creator(p_proposal)` still requires an accepted agreement and takes the price from it.

**Hire → Fund project.**
- A hire starts as `awaiting_funding`, and the brand lands on **Fund project**, a simulated payment sheet labelled "Demo, no real money" that funds the existing demo escrow (`unfunded` → `funded`, shown as "Pending funding").
- Until it's funded, the creator sees "Waiting for the brand to fund" and can't start or submit. The brand can't assign tasks, and the creator isn't counted as a collaborator or added to the group chat.
- This is enforced by `create_submission`, a `submissions` insert trigger, `create_campaign_task`, `is_campaign_collaborator`, `campaign_stats` and `sync_campaign_group`.
- Funding moves the project to `in_progress`, notifies the creator, and makes them a collaborator; the group chat rule for 2+ creators still applies.
- The brand gets a notification plus a persistent banner, sees the hire under "Awaiting funding" in the collaborators panel, and can **Cancel hire** (nothing was paid, so there is no refund).
- The rest is unchanged: submission → review → approval → release → clean download → certificate.
- Existing hires that were never funded move to `awaiting_funding` (0024). They also leave the campaign group chat quietly until funded.

**Removed.**
- "Revisions" is gone from offer terms (form, cards, validation, stored terms). Creative Review's **Request revision** is untouched.
- **Invite** is gone (`invite_creator` RPC, the Studio button, the service). Message and Shortlist cover it, and old invite notifications now read "shared the brief with you".

**AI Creator Finder** (brand Discover page, "Find with AI").
1. Gemini extracts requirements from the idea, using the brief builder's lookup vocabulary.
2. The idea is embedded (`gemini-embedding-2`, 768 dimensions).
3. `run_ai_match` ranks **all** available creators in SQL: semantic similarity (pgvector) + tools/skills/style/content type/specialization overlap + experience and completed projects + availability. Weights live in `src/config/ai-match.ts`.
4. The top results are stored and paginated. The 0-100 **Match score** is relevance, not a talent rating.

More details:
- **Why this creator?** is generated only on click, from that creator's real evidence (`ai_match_evidence`), and cached in `ai_match_reasons`.
- **Embeddings:** creators get vectors in `creator_embeddings`, never exposed to clients. Profile, attribute and portfolio changes mark them stale through triggers. Stale ones are re-embedded in the background after searches and creator saves (`/api/ai/embeddings`); backfill with `npm run ai:embeddings`.
- **Fallbacks:** if parsing or embeddings fail, ranking falls back to tags and keywords with a notice.
- **Limits and history:** searches are persisted (`ai_match_searches`, `ai_match_results`, with Save per result), reopenable as recent searches, and rate-limited per brand in the database (15 per 10 minutes). Jobs are logged in `ai_job_logs`.
- **Config:** `GEMINI_API_KEY`, already used. **`AI_FINDER_SEND_CREATOR_DATA=true`** is required before any creator profile or portfolio text is sent to Gemini (embeddings, "Why this creator?"). Off by default: the finder still works, ranked by tags and keywords. `GEMINI_EMBEDDING_MODEL` is optional (default `gemini-embedding-2`; creator vectors always use this one model, and queries fall back to `gemini-embedding-001`). The pgvector extension is enabled by the migration.

New: tables `creator_embeddings`, `ai_match_searches`, `ai_match_results`, `ai_match_reasons`; routes `/api/ai/match`, `/api/ai/match/[searchId]/reason`, `/api/ai/embeddings`; components `discovery/ai-finder.tsx`; scripts `npm run ai:embeddings`, `npm run test:ai-finder`.

### 2026-10-23: Negotiated hiring, published-only shortlists, creator targets, collaborators

Migration: `supabase/migrations/0022_negotiated_hiring_collaborators.sql`. Every rule below is enforced in the database (RPCs, triggers, RLS), not only in the UI.

**Hiring (no more direct hires).**
1. *Hire* opens (or creates) the brand ↔ creator conversation for that brief. A pinned card shows the brief summary, the creator's proposed price and the terms status (open → negotiating → agreed → final proposal sent → hired). Nobody is hired yet.
2. Both sides negotiate with structured **offers**: price, deliverables, deadline, revisions and usage rights, with *Accept* / *Counter* buttons, alongside normal text. Terms are agreed when one side accepts the other's latest offer.
3. The creator then sends a **final proposal**. It is a new version built server-side from the agreed offer, and older versions become `superseded`.
4. The brand clicks **Accept & hire**. Only then does `hire_creator(p_proposal)` run, with the proposal's price and terms; the client never sends a price. It opens the same internal demo escrow as before (funded after approval, the brand releases payment).

The old `hire_creator(campaign, creator, amount, currency)` now always refuses. A new offer re-opens agreed terms and supersedes a waiting proposal. Each step notifies the other side (notification type `proposal`). Existing hires were backfilled as accepted v1 proposals. Legacy hires that never had a fee agree one the same way, and accepting the proposal opens their escrow.

**Shortlists** need a published (`active`) brief: a trigger plus the insert policy. Draft, completed or closed briefs block new shortlists, and the UI disables the button with "Publish the brief first" and a *Publish brief* shortcut. Existing shortlists stay; ones added while a brief was still a draft are flagged (`campaign_shortlists.added_while_draft`). Swipe *Save* bookmarks are unaffected.

**Creator count is a target, not a cap.** It ranges from 1 to 100, and brands can hire beyond it ("6 of 5 hired", *Add more creators*). Editing can't lower it below the creators already hired (trigger `campaigns_target_floor`). One reusable `Stepper` (`src/components/ui/stepper.tsx`) edits it in the brief form, the Studio and the sprint form: [−] [number] [+], typed input that commits on blur/Enter, and arrow / Page / Home / End keys.

**Swipe** is its own item in the brand navigation (desktop rail and mobile bar). It is the same `/swipe` page that Discover and briefs link to.

**Collaborators.**
- Each brief card on the brand dashboard shows "N Collaborator(s)". N counts hired creators that aren't cancelled or rejected, from the `campaign_stats` view.
- Clicking it opens a panel with members, status, chats, the group chat and tasks.
- When a second creator is hired, one **group conversation** per brief is created automatically (`conversations.type = 'group'`). Later hires join it and removed creators leave, each with a system message.
- **Tasks** (`campaign_tasks`): the brand assigns a task to one creator (posted in their brief chat) or to the whole group (posted in the group chat). Creators see their tasks on their project page and can update the status. RLS limits visibility to the brand and the assigned or hired creators.

New tables: `proposals`, `campaign_tasks`. New columns: `conversations.type` and `conversations.campaign_id`; `messages.payload` (`messages.kind` is the message type: `user` = text, `system`, `offer`, `proposal`, `task`); `campaign_shortlists.added_while_draft`.

New RPCs: `start_negotiation`, `send_offer`, `accept_offer`, `send_final_proposal`, `reject_proposal`, `hire_creator(p_proposal)`, `get_negotiation`, `get_conversation`, `get_campaign_collaborators`, `create_campaign_task`, `update_campaign_task_status`, `delete_campaign_task`.

New components: `chat/negotiation.tsx`, `workspace/hire-button.tsx` (replaces the hire dialog), `workspace/collaborators.tsx`, `campaign/shortlist-gate.tsx`, `ui/stepper.tsx`. New test: `npm run test:hiring`.

---

## Features

| Area | What works |
|---|---|
| **Creator profiles & AI portfolios** | Social header with real follower, following, pieces and likes counts. Follow, Contact and Edit profile. Specialisations, tools (with proficiency), skills, content types, styles, languages, platforms, rates, workflow overview and past brand work. Portfolio pieces are uploaded to Storage or pasted as links (YouTube, Vimeo, Instagram, TikTok, Behance). Each piece records tools, an ordered workflow pipeline, workflow notes, content type, style, aspect ratio and commercial-use clearance. A post modal shows likes, comments and save. |
| **Verification (bonus)** | Badges for verified tools, documented workflows, verified past work and identity checks. Every badge explains *what* was checked and *how*. Creators request verification; admins review the requests, and each decision is audit-logged and notifies the creator. |
| **Discovery & filtering** | Debounced Postgres search across names, bios, posts, tools, skills and categories. Combinable multi-select filters: tools, skills, specialisation, content type, style, experience, availability, language and verified-only. Filters sync to the URL. Results show a count, can be sorted three ways and load with infinite scroll. When nothing matches, the **empty state names each filter that is costing results** ("removing it shows 4 creators"), offers one-click removal, and lists related creators. |
| **Briefs & campaigns** | Structured brief: content type, style, category, aspect ratios (including custom), platforms, audience, tools, skills, languages, budget, deadline and creators needed. Commercial-use terms: usage rights, territory, duration, exclusivity, licence type and AI-disclosure requirement. Statuses run draft → active → completed, and pipeline counts are computed live. |
| **AI brief builder (bonus)** | One sentence goes to a server-side Gemini call. The response must follow a JSON schema whose enums come from the live lookup tables. Zod validates the output, and the server maps names to IDs. The result pre-fills the form for review. Assumptions the AI made are listed. Without a key, or if the call fails, the user gets a clear message and the manual form. |
| **Explainable matching** | Each brief ranks creators with a 0–100 *relevance* score. Weights: tools 25, portfolio relevance 25, skills 20, campaign experience 10, platform/audience fit 10, availability 10. Every match shows a per-factor breakdown and a "Why this creator?" line. |
| **Swipe** | A Framer Motion card stack: drag, keyboard arrows, pass, like, shortlist (brand + brief), follow, contact and view. Every action is stored as an interaction, and creators you've already swiped never reappear. |
| **Opportunities** | Creators see active briefs ranked against their profile, with reasons. They can save, apply with a pitch and fee, withdraw, or mark a brief "Not for me". |
| **Messaging** | Realtime 1:1 chat on Supabase Realtime, with unread counts, search and paginated history. Creators get Brand and Creator tabs. "Contact" opens or creates the conversation. |
| **Notifications** | Generated by database triggers: follow, like, comment, application, shortlisted, selected, message and verification result. The bell updates live. |
| **Home / For you** | A feed scored from follows, tool and category affinity (likes, saves, swipes), freshness, popularity and per-user exploration. It caps how many posts one creator can take up, and pages are stable. |
| **Creator dashboard** | Opened via **Dashboard** on a creator's own profile (`/dashboard`, creator-only). KPI cards (views, followers, engagement rate, profile visits, brand inquiries, earnings) with count-up, delta vs the previous period and sparklines. Performance, audience, content-insight and career sections, plus evidence-backed AI insights. Range presets (7D/30D/90D/custom), compare-to-previous, metric switches, crosshair tooltips, click-to-open posts, table views and CSV export. All aggregation runs in SQL (`0014`, `0015`): views and visits are recorded from the real UI (de-duplicated per viewer per 30 minutes, own views excluded) and raw rows are never readable by clients. Audience groups under 5 people are withheld. AI insights only rank and phrase real counts and never show a score. |
| **Brand workspace** | The brand's **Campaigns** page is now a dashboard (live counts, shortcuts, activity, deadlines) with three sub-pages. **Campaign Studio** (`/brand/campaigns/studio`) runs Idea (plus an SSRF-guarded server-side link summary) → Zod-validated Gemini brief, editable inline with per-section Regenerate and a manual fallback → reusable Brand DNA guidelines (logo upload with palette suggestions) → ranked creators with invite/shortlist. Drafts autosave, and Publish notifies the best-matching creators. **Creative Review** (`/brand/campaigns/review`) has an inbox with filters, watermarked previews, version switching, compare mode, and Approve / Request revision (feedback required) / Reject. **Hiring & Delivery** (`/brand/campaigns/hiring`) covers 48-hour sprints with a live countdown, candidates with previews and compare, hiring with an agreed fee, and active delivery. |
| **Creator projects & submissions** | **My projects** tab in Opportunities, plus a project page with the brief, guidelines, deadline, fee, payment status and timeline. Originals upload to a **private** bucket. The server builds watermarked previews (sharp for images; ffmpeg video when available, otherwise watermarked frames), plus a SHA-256 hash and palette. The creator declares AI generation and commercial-use terms, and resubmits as new versions. Every transition is validated in the DB state machine and notifies the other party, with a system message in their chat. |
| **AI review (background job)** | Runs after each submission (pending/running/done/failed, retry, `ai_job_logs`). Colours and format are measured deterministically. Logo, visual style and typography are Gemini vision checks, labelled AI-assisted. The brand-match score comes only from that checklist. The AI-disclosure check compares the declaration with the brief and never claims to detect AI. Hook, pacing and retention are labelled estimates, with their basis. |
| **Escrow (test mode) & licence records** | An internal escrow ledger (unfunded → funded → released / refunded / disputed) with an append-only `payment_events` log, labelled "Test mode, no real money moves". The brand gets clean originals through short-lived signed URLs only after approval **and** funding (enforced by storage RLS). Release completes the project, updates creator earnings, and issues a PDF licence record (terms snapshot, declared tools, asset SHA-256 hashes) that anyone can check at `/verify/{id}`. The creator gets an earnings receipt PDF. |
| **Admin** | Platform stats, sign-ups chart and top tools. Users (verify or suspend), verification queue, content removal, report resolution, campaigns and audit log. |

Design follows the reference brief's glassmorphism: frosted panels, one amber accent, white pill CTAs with an amber arrow, a floating icon rail with bottom tabs on mobile, notched stat tiles, and line-art backdrops. Light and dark themes are included. Every screen has skeleton, empty, error-with-retry and toast states. Likes, saves and follows update optimistically.

---

## 1. Install

Requirements: Node 20+ (tested on 22) and a Supabase Cloud project.

```bash
npm install
```

## 2. Configure Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **Auth → URL configuration.** Supabase only redirects to allow-listed URLs and otherwise falls back to the Site URL.
   - **Site URL:** your production URL, e.g. `https://creatora-ai-psi.vercel.app`.
   - **Redirect URLs:** `https://<your-domain>/auth/callback`, `https://<your-domain>/auth/confirm`, and for local development `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/confirm`.
   - **Recommended:** under *Email Templates → Confirm signup*, change the link to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
     so the link works on any device. The default link uses PKCE and only signs the user in automatically in the browser they signed up with.
3. **Auth → Providers → Email.** Email + password is enabled by default.
   - With *Confirm email* on, sign-up shows "check your inbox".
   - With it off, users go straight to onboarding. That's convenient for demos.
4. Storage buckets and Realtime publications are created by the migrations; no manual steps are needed.

## 3. Environment variables

Copy `.env.example` to `.env.local` and fill it in. Never commit `.env.local`.

| Variable | Where it's used | Exposure |
|---|---|---|
| `SUPABASE_URL` | Browser + server | Public. Mapped to the browser in `next.config.ts` |
| `SUPABASE_PUBLISHABLE_KEY` | Browser + server | Public. RLS protects all data |
| `SUPABASE_SECRET_KEY` | `/api/admin`, seed and test scripts | **Server only.** Imported only in `server-only` modules |
| `SUPABASE_DB_URL` | `npm run db:migrate`, `db:types` | **Scripts only** (Dashboard → Connect → *Session pooler*) |
| `GEMINI_API_KEY` | `/api/ai/brief` | **Server only**, optional |
| `AI_FINDER_SEND_CREATOR_DATA` | AI Creator Finder, `npm run ai:embeddings` | **Server only.** `true` allows sending creator profile + portfolio text to Gemini. Default off |
| `GEMINI_EMBEDDING_MODEL` | AI Creator Finder | Optional, default `gemini-embedding-2` |
| `GEMINI_MODEL` | `/api/ai/brief` | Optional, default `gemini-3.5-flash` (falls back to 3.1-flash-lite → 3.5-flash-lite on retirement, overload or timeout) |
| `SUPABASE_JWKS_URL`, `SITE_URL` | Reserved / docs | Optional |

## 4. Run migrations

```bash
npm run db:migrate      # applies supabase/migrations/*.sql in order, once each
npm run db:migrate -- --dry-run                                     # run pending migrations, then roll back
npm run db:migrate -- --to 0023_accept_hire_funding_ai_finder.sql   # staged rollout: stop after this file
npm run db:types        # optional: regenerates src/types/database.ts from the live schema
```

Applied migrations are tracked in `private.schema_migrations`. Each file runs in its own transaction and waits at most 5 s for table locks, so it fails fast instead of blocking traffic.

> Newer Supabase projects don't auto-grant table privileges to the API roles. `0011_api_grants.sql` sets them explicitly: clients read through RLS and write only specific tables and columns; the service role has full access.

## 5. Seed the 10 demo accounts

```bash
npm run seed            # idempotent: safe to run again
```

The seed creates real Auth users through the Auth admin API. Each login works with the shared password below.

**Password for all demo accounts:** `CreatoraDemo#2026`

| Role | Email | Who |
|---|---|---|
| Creator | `maya@demo.creatora.ai` | Maya Okafor · AI film (verified) |
| Creator | `kenji@demo.creatora.ai` | Kenji Watanabe · 3D animation (verified) |
| Creator | `sofia@demo.creatora.ai` | Sofía Marín · fashion visuals (verified) |
| Creator | `arjun@demo.creatora.ai` | Arjun Mehta · motion design |
| Creator | `lena@demo.creatora.ai` | Lena Fischer · music-video visuals |
| Creator | `diego@demo.creatora.ai` | Diego Santos · product ads |
| Brand | `atelier@demo.creatora.ai` | Atelier Nova · fashion label |
| Brand | `orbitone@demo.creatora.ai` | Orbitone · consumer audio |
| Brand | `tidewell@demo.creatora.ai` | Tidewell Sparkling Tea · beverage |
| Admin | `admin@demo.creatora.ai` | Noor Haddad · trust & safety |

Dashboard history: each demo creator gets 90 days of generated views and profile visits (weekly rhythm, one viral spike, one dip), tagged `source = 'seed'`. Real likes, saves and follows between demo accounts are spread across the same window. Follower counts stay small because they are real follow rows between the 10 demo accounts. Most audience groups show "Not enough data yet", because no group reaches the 5-person privacy threshold.

Demo content: 29 portfolio posts with tool and workflow metadata, 7 briefs (draft, active and completed), applications, shortlists, selections, follows, likes, comments, saves, swipe signals, 4 conversations, verification records and a sample report.

- **Media:** royalty-free stock (Unsplash images, cropped to each post's aspect ratio and copied into Supabase Storage; Mixkit clips for videos). It stands in for AI-generated work.
- **Isolation:** every seeded row belongs to the 10 demo users and uses deterministic IDs. Re-running only upserts, and never touches anyone else's data. New sign-ups get a fresh UUID and an empty profile.

## 6. Run locally

```bash
npm run dev             # http://localhost:3000
```

## 7. Build and checks

```bash
npm run typecheck && npm run lint && npm run build
npm run test:rls        # permission + integrity checks against your Supabase project (needs seed)
npm run test:workspace  # brand workspace acceptance flow against a running app (APP_URL, default localhost:3000)
npm run test:hiring     # accept → hire → fund, shortlist rule, creator targets, group chat + tasks (throwaway accounts)
npm run test:ai-finder  # AI Creator Finder routes, ranking, cached reasons, fallback, RLS (running app)
npm run ai:embeddings   # build / refresh creator embeddings for the AI Creator Finder
```

`test:workspace` uses throwaway accounts and deletes them afterwards. It covers:
- submit → watermarked preview + AI review → revision → v2 → approve
- fund → originals unlock → release → licence PDF + public verification → receipt + earnings
- sprint deadline enforcement
- cross-user access being refused

Run `npm run seed` to also seed the workspace demo states:
- brand guidelines
- a Studio draft
- a live sprint
- a submission awaiting review
- a revision request
- completed, paid projects with licence records

`test:rls` runs about 50 checks. They cover:
- demo logins
- a brand-new user starting empty
- role escalation, self-verification and fake counters being blocked
- private messages, notifications and applications staying private
- triggers updating counts and generating notifications
- realtime-backed messaging between participants only
- the discovery and ranking RPCs returning data

## 8. Deploy (Vercel)

1. Push the repo to GitHub and import it in Vercel. The framework preset is detected as Next.js and no `vercel.json` is needed.
2. Add these environment variables in Vercel for Production and Preview: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY` (optional), `GEMINI_MODEL` (optional).
   - `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are inlined at **build time**, so they must be set before the build.
3. In Supabase Auth, add `https://<your-domain>/auth/callback` to the redirect URLs and set the Site URL.
4. Run migrations and the seed from your machine against the production project. Don't run them from Vercel.

---

## Architecture

```
Browser ──(publishable key + user JWT, RLS)──▶ Supabase Postgres / Storage / Realtime
   │
   └──▶ Next.js (App Router)
          ├─ proxy.ts                session refresh + auth redirects
          ├─ server layouts          verify session & role (getClaims) before rendering
          ├─ /api/ai/brief           Gemini (server-only key), Zod-validated
          ├─ /api/admin              role re-checked; service-role writes + audit log
          └─ /api/link-preview       allow-listed oEmbed lookups (no open proxy)
```

- **Authorization in two layers.**
  - Postgres RLS on every table. Column-level grants stop users writing role, verification, suspension or counters.
  - Server checks in layouts and route handlers.
- **Business logic lives in SQL.** Search, diagnostics, ranking, swipe deck, feed, opportunities, inbox, dashboards and admin lists are Postgres functions (`supabase/migrations/0006_rpcs.sql`, `0010_read_rpcs.sql`). They return ready-to-render JSON, and the scoring is transparent and inspectable.
- **Hiring is a negotiation, enforced in SQL** (`0022`, `0023`). Offers, the agreement (an accepted offer becomes an accepted proposal) and the hire are security-definer RPCs that check who may act and when. Clients can't insert hires, proposals or structured messages, and the hire price always comes from the agreement. A hire waits in `awaiting_funding` until the brand funds the demo escrow.
- **AI Creator Finder:** `/api/ai/match` → Gemini (requirements) + embedding → `run_ai_match` (SQL over pgvector + tags) → stored, paginated results. Reasons are generated lazily and cached. Creator vectors are refreshed by triggers plus background jobs.
- **Conversations** are a plain DM per pair (`dm_key "a:b"`), one 1:1 chat per brief and pair for hiring (`dm_key "c:campaign:a:b"`), and one group per brief (`type = 'group'`). Project updates for a hire are posted in its brief chat. Group membership follows `campaign_creators` through a trigger.
- **Counts and notifications are triggers** (`0005_functions_triggers.sql`). They're never computed or stored by the client.
- **Data access** goes through `src/services/*`, one file per domain. Components never query directly. The same service functions run with the browser client (TanStack Query) or the server client.

### Where to change what

| I want to… | Edit |
|---|---|
| Add a tool, skill, style, platform or language | `supabase/migrations/0009_lookup_data.sql` (or insert rows). The UI loads lookups dynamically. |
| Change matching weights or reasons | `rank_creators_for_campaign` in `0006_rpcs.sql` |
| Tune the home feed | `get_feed` in `0006_rpcs.sql` |
| Change search behaviour or filters | `creator_search_flags` / `search_creators` (SQL), `src/services/discovery.ts`, `src/components/discovery/*` |
| Change brief fields | `0003_campaigns.sql` → `src/lib/validation/schemas.ts` (`campaignSchema`) → `src/components/campaign/campaign-form.tsx` |
| Change the AI brief prompt or schema | `src/lib/ai/brief-builder.ts` |
| Add a notification type | `0004` check constraint (latest version in `0022`) + trigger in `0005` + text and links in `src/services/notifications.ts` |
| Change the hiring negotiation (offer terms, who may act, states) | Latest RPC versions in `0023_accept_hire_funding_ai_finder.sql` (`send_offer`, `accept_offer`, `hire_creator`, `private.clean_terms`) → `src/services/messaging.ts` → `src/components/chat/negotiation.tsx` |
| Funding rules (what's blocked until funded) | `fund_escrow`, `is_campaign_collaborator`, `tg_submissions_require_funding` in `0023`; UI in `workspace/payment-card.tsx` ("Fund project") and `project-view.tsx` |
| AI Creator Finder weights / limits | `src/config/ai-match.ts` (weights, semantic calibration, page size, rate limits, embedding model) |
| AI Creator Finder logic | `run_ai_match` / `ai_match_evidence` in `0023`, `src/lib/ai/creator-finder.ts` (requirements, reasons), `src/lib/ai/embeddings.ts`, `src/components/discovery/ai-finder.tsx` |
| Change who can shortlist / the creator target rules | Triggers `shortlists_require_published` and `campaigns_target_floor` in `0022`; UI gate in `src/components/campaign/shortlist-gate.tsx` |
| Group chats, collaborators, tasks | `private.sync_campaign_group`, `get_campaign_collaborators`, `*_campaign_task*` RPCs in `0022` → `src/services/workspace.ts` → `src/components/workspace/collaborators.tsx` |
| Number inputs with − / + | `src/components/ui/stepper.tsx` |
| Change permissions | Row rules: `0007_rls.sql`. Table/column privileges for API roles: `0011_api_grants.sql` (new Supabase projects grant nothing by default, so every new table needs RLS **and** explicit grants). Then extend `supabase/scripts/test-rls.ts` |
| Restyle | Tokens in `src/app/globals.css`, primitives in `src/components/ui/*` |
| Navigation | `src/config/nav.ts` |
| Dashboard metrics / formulas | `supabase/migrations/0014_creator_dashboard.sql`, `0015_dashboard_engagement_series.sql` (`dashboard_*` RPCs) |
| Dashboard UI / charts | `src/components/dashboard/*` (chart palette tokens `--chart-1..3` in `globals.css`, validated for light and dark) |
| AI insight rules | `src/lib/ai/insights.ts` (the AI may only reference evidence ids; counts are attached server-side) |
| Demo data | `supabase/seed/data/*.ts` |

### Project layout

```
src/
  app/            (auth) login/signup · (onboarding) · (app) creator+brand screens · (admin) · api/
  components/     ui/ layout/ profile/ posts/ discovery/ campaign/ swipe/ chat/ feed/ notifications/ admin/
  features/       session context
  services/       data access (profiles, posts, social, discovery, campaigns, messaging, notifications, verification, admin)
  lib/            supabase/ (browser, server, admin, proxy) · ai/ · validation/ · utils/
  hooks/ types/ config/
supabase/
  migrations/     schema, triggers, RPCs, RLS, storage, lookups
  seed/           idempotent demo seed (npm run seed)
  scripts/        migrate · gen-types · test-rls · test-workspace · test-hiring
```

## Security notes

- The secret key and Gemini key are read only in modules marked `server-only` and in local scripts. They never use a `NEXT_PUBLIC_` prefix, and they're never sent to the browser.
- Users can't self-assign `admin`. The signup trigger maps any other value to `creator`.
- Uploads go only to `<user-id>/…` in public buckets, with MIME type and size limits.
- `link-preview` only fetches from allow-listed oEmbed providers.
- If keys were ever shared in plain text, rotate them in the Supabase and Google AI dashboards.
