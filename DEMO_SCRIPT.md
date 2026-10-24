# 3-minute demo script

All demo accounts use the password `CreatoraDemo#2026`. The sign-in page has one-click shortcuts that fill in the email and password.

**Before you start:** run `npm run seed` so the swipe deck and likes start from the seeded state. Open two browser windows: one normal, one private. Total running time is about 3 minutes.

**1. Creator profile and AI portfolio (35s).** Sign in as **Sofía** (`sofia@demo.creatora.ai`).
1. Open **Profile** from the rail. Point out:
   - real follower, like and piece counts
   - the *Verified creator* badge
   - the **Trust & verification** panel, which shows what each badge checked and how
   - the Phone Verified / Identity Verified badges (hover for what was checked)
   - tools with proficiency
   - experience, rates and the workflow overview
2. Click **Sunbeam Set**. The modal shows the tools, the workflow pipeline (ComfyUI → FLUX → Photoshop → Magnific) , the format, and *Cleared for commercial use*.
3. Like the piece and leave a comment.

**2. Discovery and the empty state (35s).** Sign out, then sign in as **Atelier Nova** (`atelier@demo.creatora.ai`).
1. Open **Discover** and type "runway". Results update live, and the URL updates with them.
2. Add the filters **AI tools: Sora** and **Language: Japanese**. Zero results.
3. The empty state lists each filter and how many creators removing it would show. Click *Remove* on one and results return. Point out *Related creators* underneath.

**3. AI brief builder (35s).** Click **+** on the rail (New brief).
1. Click the example *"Need three AI creators for a cinematic fashion campaign for Gen Z on Instagram…"* and then **Generate brief**.
2. The form fills in: content type, style, 9:16 and 4:5 formats, platforms, tools, budget, and commercial-use terms (paid social, territory, 12 months, licence, AI disclosure). The AI's assumptions are listed.
3. Edit one field, then click **Publish brief**.
4. Fallback: with no `GEMINI_API_KEY`, the page shows a clear message and the manual form still works.

**4. Ranked matches with "Why this creator?" (30s).** Publishing lands on **Ranked matches**.
1. Each card shows a relevance score and reasons such as "Uses Midjourney & Runway (2/3 required tools)" or "3 portfolio pieces match this brief's format & style".
2. Open *Score breakdown* to see the six weighted factors.
3. **Shortlist** a creator. They get a live notification.
4. Open **Applications**: real pitches, sorted by relevance.

**5. Swipe (25s).** Click **Swipe matches**.
1. Drag a card right (LIKE), press ← to pass, and ↑ to shortlist.
2. Every action is stored, and swiped creators never come back.

**6. Message in realtime (20s).** On a card, click **Contact** and send a message.
- In the private window, signed in as that creator, the inbox badge and the thread update live.

**Optional close (10s).** Sign in as `admin@demo.creatora.ai` → **Verifications**. Open Diego's pending ID (simulated check: Identity Verified), view the demo ID image, and click **Mark Verified**: the Identity Verified badge appears on his profile and every step shows in the audit log.
