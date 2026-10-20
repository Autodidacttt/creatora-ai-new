// End-to-end permission + data-integrity checks against the real Supabase project.
// Uses the PUBLISHABLE key for every user action (exactly what the browser can do).
// The secret key is only used to create/delete a throwaway "new user" account.
// Usage: npm run test:rls   (run `npm run seed` first). Set APP_URL=https://… to also check API route auth.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { requireEnv } from "./env";
import { DEMO_PASSWORD, admin as adminSeed, brands, creators } from "../seed/data/accounts";

const URL_ = requireEnv("SUPABASE_URL");
const PUB = requireEnv("SUPABASE_PUBLISHABLE_KEY");
const SECRET = requireEnv("SUPABASE_SECRET_KEY");

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

const client = () => createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(email: string, password = DEMO_PASSWORD) {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`login ${email}: ${error?.message}`);
  return { c, id: data.user.id };
}

async function main() {
  const adminApi = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log("\n▸ Demo logins");
  const all = [...creators, ...brands, adminSeed];
  const sessions: Record<string, { c: SupabaseClient; id: string }> = {};
  for (const a of all) {
    try {
      sessions[a.key] = await signIn(a.email);
      check(`${a.email} can sign in`, true);
    } catch (e) {
      check(`${a.email} can sign in`, false, String(e));
    }
  }
  const sofia = sessions.sofia, maya = sessions.maya, atelier = sessions.atelier, orbitone = sessions.orbitone, adm = sessions.admin;
  if (!sofia || !maya || !atelier || !orbitone || !adm) throw new Error("Demo accounts missing — run `npm run seed` first.");

  console.log("\n▸ New users start empty (and can't self-assign admin)");
  const email = `rls-check-${Date.now()}@example.com`;
  const created = await adminApi.auth.admin.createUser({
    email, password: "Fresh-Account-123", email_confirm: true,
    user_metadata: { role: "admin", display_name: "Fresh Tester" },
  });
  if (created.error || !created.data.user) throw new Error(`create test user: ${created.error?.message}`);
  const fresh = await signIn(email, "Fresh-Account-123");
  try {
    const prof = await fresh.c.from("profiles").select("role, is_verified, onboarded").eq("id", fresh.id).single();
    check("profile row created by trigger", !!prof.data);
    check("'admin' in signup metadata is downgraded to creator", prof.data?.role === "creator", prof.data?.role);
    check("new user is not verified", prof.data?.is_verified === false);
    const stats = await fresh.c.from("profile_stats").select("*").eq("profile_id", fresh.id).single();
    check("all counters start at zero",
      !!stats.data && stats.data.followers_count === 0 && stats.data.following_count === 0 && stats.data.posts_count === 0 && stats.data.likes_received_count === 0);
    const [posts, notes, convs, saves, follows, tools] = await Promise.all([
      fresh.c.from("posts").select("id", { count: "exact", head: true }).eq("creator_id", fresh.id),
      fresh.c.from("notifications").select("id", { count: "exact", head: true }),
      fresh.c.from("conversation_participants").select("conversation_id", { count: "exact", head: true }),
      fresh.c.from("saves").select("post_id", { count: "exact", head: true }),
      fresh.c.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", fresh.id),
      fresh.c.from("creator_tools").select("tool_id", { count: "exact", head: true }).eq("creator_id", fresh.id),
    ]);
    check("no posts", posts.count === 0);
    check("no notifications", notes.count === 0);
    check("no conversations", convs.count === 0);
    check("no saves", saves.count === 0);
    check("no follows", follows.count === 0);
    check("no inherited tools/skills", tools.count === 0);

    console.log("\n▸ Users can only edit their own rows");
    const before = await maya.c.from("profiles").select("bio").eq("id", maya.id).single();
    const hijack = await sofia.c.from("profiles").update({ bio: "hacked" }).eq("id", maya.id).select("id");
    const after = await maya.c.from("profiles").select("bio").eq("id", maya.id).single();
    check("cannot update another user's profile", (hijack.data?.length ?? 0) === 0 && after.data?.bio === before.data?.bio);
    const roleEsc = await sofia.c.from("profiles").update({ role: "admin" } as never).eq("id", sofia.id);
    check("cannot change own role", !!roleEsc.error, "update succeeded");
    const verEsc = await fresh.c.from("profiles").update({ is_verified: true } as never).eq("id", fresh.id);
    check("cannot self-verify", !!verEsc.error, "update succeeded");
    const statsEsc = await sofia.c.from("profile_stats").update({ followers_count: 99999 }).eq("profile_id", sofia.id);
    const statsAfter = await sofia.c.from("profile_stats").select("followers_count").eq("profile_id", sofia.id).single();
    check("cannot write counters", !!statsEsc.error || statsAfter.data?.followers_count !== 99999);
    const mayaPost = await maya.c.from("posts").select("id, title").eq("creator_id", maya.id).limit(1).single();
    const postEdit = await sofia.c.from("posts").update({ title: "hijacked" }).eq("id", mayaPost.data!.id).select("id");
    check("cannot edit another creator's post", (postEdit.data?.length ?? 0) === 0);
    const fakeLike = await sofia.c.from("likes").insert({ user_id: maya.id, post_id: mayaPost.data!.id });
    check("cannot like on someone else's behalf", !!fakeLike.error);
    const inflated = await fresh.c.from("posts").insert({ creator_id: fresh.id, title: "Count test", media_type: "image", media_url: "https://example.com/x.jpg", likes_count: 5000 } as never).select("id, likes_count").single();
    check("client-supplied like counts are ignored", inflated.data?.likes_count === 0, JSON.stringify(inflated.data ?? inflated.error));
    if (inflated.data) await fresh.c.from("posts").delete().eq("id", inflated.data.id);

    console.log("\n▸ Role enforcement");
    const creatorCampaign = await sofia.c.from("campaigns").insert({ brand_id: sofia.id, title: "Not allowed", description: "Creators cannot post briefs" });
    check("creators cannot create briefs", !!creatorCampaign.error);
    const brandPost = await atelier.c.from("posts").insert({ creator_id: atelier.id, title: "Nope", media_type: "image", media_url: "https://example.com/x.jpg" });
    check("brands cannot create portfolio posts", !!brandPost.error);
    const tool = await sofia.c.from("creator_tools").select("tool_id").eq("creator_id", sofia.id).limit(1).single();
    const selfApproved = await sofia.c.from("verifications").insert({ creator_id: sofia.id, type: "tool", tool_id: tool.data!.tool_id, title: "Self approval attempt", status: "approved" }).select("id, status").single();
    check("self-submitted verification is forced to pending", selfApproved.data?.status === "pending", JSON.stringify(selfApproved.data ?? selfApproved.error));
    if (selfApproved.data) await sofia.c.from("verifications").delete().eq("id", selfApproved.data.id);
    const statsRpc = await sofia.c.rpc("admin_stats");
    check("non-admins cannot read admin stats", !!statsRpc.error);
    const adminStats = await adm.c.rpc("admin_stats");
    check("admin can read admin stats", !adminStats.error && !!adminStats.data);

    console.log("\n▸ Private data stays private");
    const mayaNotes = await sofia.c.from("notifications").select("id").eq("user_id", maya.id);
    check("cannot read another user's notifications", (mayaNotes.data?.length ?? 0) === 0);
    const mayaConvs = await maya.c.rpc("get_inbox", {});
    const convId = mayaConvs.data?.[0]?.conversation_id;
    if (convId) {
      const peek = await fresh.c.from("messages").select("id").eq("conversation_id", convId);
      check("non-participants cannot read messages", (peek.data?.length ?? 0) === 0);
      const inject = await fresh.c.from("messages").insert({ conversation_id: convId, sender_id: fresh.id, body: "intrusion" });
      check("non-participants cannot post into a conversation", !!inject.error);
    }
    const drafts = await sofia.c.from("campaigns").select("id").eq("status", "draft");
    check("brand drafts are invisible to others", (drafts.data?.length ?? 0) === 0);
    const orbCampaigns = await orbitone.c.from("campaigns").select("id").eq("brand_id", orbitone.id);
    const ids = (orbCampaigns.data ?? []).map((c) => c.id);
    const theirApps = await atelier.c.from("campaign_applications").select("id").in("campaign_id", ids);
    check("brands cannot see another brand's applications", (theirApps.data?.length ?? 0) === 0);
    const ownApps = await orbitone.c.from("campaign_applications").select("id").in("campaign_id", ids);
    check("brand sees applications to its own briefs", (ownApps.data?.length ?? 0) > 0);
    const otherSaves = await fresh.c.from("saves").select("post_id").eq("user_id", atelier.id);
    check("saves are private", (otherSaves.data?.length ?? 0) === 0);

    console.log("\n▸ Real relationships, counts and notifications");
    const followersBefore = (await fresh.c.from("profile_stats").select("followers_count").eq("profile_id", maya.id).single()).data!.followers_count;
    const f = await fresh.c.from("follows").insert({ follower_id: fresh.id, following_id: maya.id });
    check("follow persists", !f.error, f.error?.message);
    const followersAfter = (await fresh.c.from("profile_stats").select("followers_count").eq("profile_id", maya.id).single()).data!.followers_count;
    check("follower count increments via trigger", followersAfter === followersBefore + 1, `${followersBefore} → ${followersAfter}`);
    const followNote = await maya.c.from("notifications").select("id").eq("type", "follow").eq("actor_id", fresh.id);
    check("followed user gets a notification", (followNote.data?.length ?? 0) === 1);
    await fresh.c.from("follows").delete().eq("follower_id", fresh.id).eq("following_id", maya.id);
    const followersFinal = (await fresh.c.from("profile_stats").select("followers_count").eq("profile_id", maya.id).single()).data!.followers_count;
    check("unfollow decrements", followersFinal === followersBefore);

    const likesBefore = (await fresh.c.from("posts").select("likes_count").eq("id", mayaPost.data!.id).single()).data!.likes_count;
    await fresh.c.from("likes").insert({ user_id: fresh.id, post_id: mayaPost.data!.id });
    const likesAfter = (await fresh.c.from("posts").select("likes_count").eq("id", mayaPost.data!.id).single()).data!.likes_count;
    check("like count increments", likesAfter === likesBefore + 1);
    await fresh.c.from("likes").delete().eq("user_id", fresh.id).eq("post_id", mayaPost.data!.id);

    const dm = await fresh.c.rpc("get_or_create_dm", { p_other: maya.id });
    check("can open a DM", !dm.error && !!dm.data, dm.error?.message);
    const sent = await fresh.c.from("messages").insert({ conversation_id: dm.data!, sender_id: fresh.id, body: "Hello from the RLS check" }).select("id").single();
    check("message persists", !sent.error);
    const mayaSees = await maya.c.from("messages").select("id").eq("id", sent.data!.id);
    check("recipient can read the message", (mayaSees.data?.length ?? 0) === 1);
    const sofiaSees = await sofia.c.from("messages").select("id").eq("id", sent.data!.id);
    check("third party cannot read the message", (sofiaSees.data?.length ?? 0) === 0);
    const unread = await maya.c.rpc("get_unread_counts");
    check("recipient unread count reflects it", ((unread.data as { messages?: number } | null)?.messages ?? 0) >= 1);

    console.log("\n▸ Discovery & matching RPCs return real data");
    const search = await sofia.c.rpc("search_creators", { p_query: "runway" });
    check("search finds creators by tool name", (search.data?.length ?? 0) > 0);
    const none = await sofia.c.rpc("search_creators", { p_query: "zzzz-no-such-creator" });
    check("search returns empty for nonsense", (none.data?.length ?? 0) === 0);
    const camp = ids[0];
    const ranked = await orbitone.c.rpc("rank_creators_for_campaign", { p_campaign_id: camp });
    check("brief ranking returns scores with reasons", (ranked.data?.length ?? 0) > 0 && (ranked.data?.[0]?.reasons?.length ?? 0) > 0);
    const feed = await fresh.c.rpc("get_feed", {});
    check("new user gets a feed of other creators' work", (feed.data?.length ?? 0) > 0);

    console.log("\n▸ Message read status & notifications");
    const msgNote = await maya.c.from("notifications").select("id, read_at").eq("type", "message").eq("entity_id", dm.data!);
    check("recipient gets an unread message notification", (msgNote.data?.length ?? 0) === 1 && msgNote.data![0].read_at === null);
    const unreadBefore = (unread.data as { messages: number }).messages;
    const mark = await maya.c.rpc("mark_conversation_read", { p_conversation: dm.data! });
    const unreadAfter = ((await maya.c.rpc("get_unread_counts")).data as { messages: number }).messages;
    check("opening the thread marks it read", !mark.error && unreadAfter === unreadBefore - 1, `${unreadBefore} → ${unreadAfter}`);
    const noteAfter = await maya.c.from("notifications").select("read_at").eq("type", "message").eq("entity_id", dm.data!).single();
    check("…and clears its notification", !!noteAfter.data?.read_at);
    const spoof = await fresh.c.from("messages").insert({ conversation_id: dm.data!, sender_id: maya.id, body: "spoofed sender" });
    check("cannot send a message as someone else", !!spoof.error);

    console.log("\n▸ Profile editing");
    const edit = await fresh.c.from("profiles").update({ display_name: "Fresh Tester Edited", headline: "Testing edits" }).eq("id", fresh.id).select("display_name").single();
    check("users can edit their own profile", edit.data?.display_name === "Fresh Tester Edited", edit.error?.message);
    const det = await fresh.c.from("creator_details").update({ availability: "limited" }).eq("profile_id", fresh.id).select("availability").single();
    check("creators can edit their own details", det.data?.availability === "limited", det.error?.message);

    console.log("\n▸ Storage permissions");
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));
    const own = await fresh.c.storage.from("post-media").upload(`${fresh.id}/rls-check.png`, png, { contentType: "image/png", upsert: true });
    check("users can upload into their own folder", !own.error, own.error?.message);
    const pubUrl = fresh.c.storage.from("post-media").getPublicUrl(`${fresh.id}/rls-check.png`).data.publicUrl;
    check("uploaded media is publicly readable", (await fetch(pubUrl)).ok);
    const foreign = await fresh.c.storage.from("post-media").upload(`${maya.id}/intrusion.png`, png, { contentType: "image/png" });
    check("cannot upload into another user's folder", !!foreign.error);
    const anonUp = await client().storage.from("avatars").upload(`${maya.id}/anon.png`, png, { contentType: "image/png" });
    check("anonymous visitors cannot upload", !!anonUp.error);
    const badType = await fresh.c.storage.from("avatars").upload(`${fresh.id}/script.html`, new TextEncoder().encode("<script></script>"), { contentType: "text/html" });
    check("disallowed file types are rejected", !!badType.error);
    const rmForeign = await fresh.c.storage.from("post-media").remove([`${maya.id}/maya-lighthouse.jpg`]);
    const stillThere = (await fetch(maya.c.storage.from("post-media").getPublicUrl(`${maya.id}/maya-lighthouse.jpg`).data.publicUrl)).ok;
    check("cannot delete another user's media", stillThere, JSON.stringify(rmForeign.error));
    await fresh.c.storage.from("post-media").remove([`${fresh.id}/rls-check.png`]);

    console.log("\n▸ Campaign → application pipeline");
    const brandEmail = `rls-brand-${Date.now()}@example.com`;
    const brandUser = await adminApi.auth.admin.createUser({ email: brandEmail, password: "Fresh-Account-123", email_confirm: true, user_metadata: { role: "brand", display_name: "RLS Brand" } });
    try {
      const brand = await signIn(brandEmail, "Fresh-Account-123");
      const draft = await brand.c.from("campaigns").insert({ brand_id: brand.id, title: "RLS check brief", description: "Temporary brief for permission checks", status: "draft", aspect_ratios: ["9:16"] }).select("id").single();
      check("brand can create a brief", !draft.error, draft.error?.message);
      const seeDraft = await fresh.c.from("campaigns").select("id").eq("id", draft.data!.id);
      check("creators cannot see a draft brief", (seeDraft.data?.length ?? 0) === 0);
      const earlyApply = await fresh.c.from("campaign_applications").insert({ campaign_id: draft.data!.id, creator_id: fresh.id, pitch: "Applying before publication" });
      check("cannot apply to a draft brief", !!earlyApply.error);
      await brand.c.from("campaigns").update({ status: "active" }).eq("id", draft.data!.id);
      const app = await fresh.c.from("campaign_applications").insert({ campaign_id: draft.data!.id, creator_id: fresh.id, pitch: "I would love to work on this brief" }).select("id, status").single();
      check("creator can apply once the brief is active", app.data?.status === "pending", app.error?.message);
      const brandNote = await brand.c.from("notifications").select("id").eq("type", "application").eq("entity_id", draft.data!.id);
      check("brand is notified of the application", (brandNote.data?.length ?? 0) === 1);
      const otherBrand = await atelier.c.from("campaign_applications").select("id").eq("id", app.data!.id);
      check("other brands cannot see the application", (otherBrand.data?.length ?? 0) === 0);
      const selfReject = await fresh.c.from("campaign_applications").update({ status: "rejected" }).eq("id", app.data!.id);
      check("creator cannot change their application to 'rejected'", !!selfReject.error);
      const reject = await brand.c.from("campaign_applications").update({ status: "rejected" }).eq("id", app.data!.id).select("status").single();
      check("owning brand can decline an application", reject.data?.status === "rejected", reject.error?.message);
      const pitchEdit = await brand.c.from("campaign_applications").update({ pitch: "brand rewrote this" }).eq("id", app.data!.id);
      check("brand cannot rewrite a creator's pitch", !!pitchEdit.error);
      const sl = await brand.c.from("campaign_shortlists").insert({ campaign_id: draft.data!.id, creator_id: fresh.id, added_by: brand.id });
      check("brand can shortlist", !sl.error, sl.error?.message);
      const slOther = await atelier.c.from("campaign_shortlists").insert({ campaign_id: draft.data!.id, creator_id: fresh.id, added_by: atelier.id });
      check("other brands cannot shortlist into someone else's brief", !!slOther.error);

      console.log("\n▸ Creator dashboard: privacy and real-data flow");
      const today = new Date().toISOString().slice(0, 10);
      const monthAgo = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
      const range = { p_from: monthAgo, p_to: today };
      const freshSummary = await fresh.c.rpc("dashboard_summary", { p_creator: fresh.id, ...range });
      const fs0 = freshSummary.data as { current: Record<string, number | null>; has_activity: boolean } | null;
      check("a brand-new creator's dashboard starts at zero (no inherited demo data)", !freshSummary.error && fs0?.current.views === 0 && fs0?.current.followers === 0 && fs0?.current.earnings === 0, freshSummary.error?.message);
      const peek = await maya.c.rpc("dashboard_summary", { p_creator: sofia.id, ...range });
      check("another creator cannot read someone else's dashboard", !!peek.error);
      const brandPeek = await brand.c.rpc("dashboard_series", { p_creator: brand.id, ...range });
      check("dashboards are creator-only (brands are refused)", !!brandPeek.error);
      for (const fn of ["dashboard_posts", "dashboard_audience", "dashboard_content", "dashboard_career"] as const) {
        const r = await maya.c.rpc(fn, { p_creator: sofia.id, ...range });
        check(`${fn}: another user is refused`, !!r.error);
      }
      const evidencePeek = await maya.c.rpc("dashboard_ai_evidence", { p_creator: sofia.id });
      check("AI evidence of another creator is refused", !!evidencePeek.error);
      const rawViews = await sofia.c.from("post_views").select("id").limit(1);
      check("raw post_views rows are not readable from the client", !!rawViews.error || (rawViews.data?.length ?? 0) === 0);
      const rawVisits = await sofia.c.from("profile_visits").select("id").limit(1);
      check("raw profile_visits rows are not readable from the client", !!rawVisits.error || (rawVisits.data?.length ?? 0) === 0);
      const fakeView = await fresh.c.from("post_views").insert({ post_id: mayaPost.data!.id, creator_id: maya.id } as never);
      check("views cannot be inserted directly (only via the de-duplicating RPC)", !!fakeView.error);
      const otherInsights = await maya.c.from("creator_ai_insights").select("creator_id").eq("creator_id", sofia.id);
      check("another creator's cached AI insights are not readable", (otherInsights.data?.length ?? 0) === 0);

      const viewsOf = async () => ((await adminApi.from("post_views").select("id", { count: "exact", head: true }).eq("post_id", mayaPost.data!.id).eq("source", "app")).count ?? 0);
      const v0 = await viewsOf();
      await maya.c.rpc("record_post_view", { p_post: mayaPost.data!.id });
      check("a creator viewing their own post is not counted", (await viewsOf()) === v0);
      await fresh.c.rpc("record_post_view", { p_post: mayaPost.data!.id, p_watch_ms: 3000 });
      await fresh.c.rpc("record_post_view", { p_post: mayaPost.data!.id, p_watch_ms: 2000 });
      const freshRows = await adminApi.from("post_views").select("watch_duration").eq("post_id", mayaPost.data!.id).eq("viewer_id", fresh.id);
      check("repeat views within 30 minutes are de-duplicated (watch time accumulates)", (await viewsOf()) === v0 + 1 && freshRows.data?.[0]?.watch_duration === 5000);

      const before = ((await maya.c.rpc("dashboard_summary", { p_creator: maya.id, ...range })).data as { current: { likes: number; views: number } }).current;
      await fresh.c.from("likes").insert({ user_id: fresh.id, post_id: mayaPost.data!.id });
      const after = ((await maya.c.rpc("dashboard_summary", { p_creator: maya.id, ...range })).data as { current: { likes: number; views: number } }).current;
      check("a real like changes the creator's dashboard", after.likes === before.likes + 1, `${before.likes} → ${after.likes}`);
      await fresh.c.from("likes").delete().eq("user_id", fresh.id).eq("post_id", mayaPost.data!.id);

      const hire = await brand.c.from("campaign_creators").insert({ campaign_id: draft.data!.id, creator_id: fresh.id, agreed_amount: 750, currency: "USD", payment_status: "paid", paid_at: new Date().toISOString() });
      const career = (await fresh.c.rpc("dashboard_career", { p_creator: fresh.id, ...range })).data as { hired: number; earned_in_range: number } | null;
      check("a real hire + payment changes the career and earnings figures", !hire.error && career?.hired === 1 && career?.earned_in_range === 750, hire.error?.message);
    } finally {
      await adminApi.auth.admin.deleteUser(brandUser.data.user!.id);
    }

    const appUrl = process.env.APP_URL;
    if (appUrl) {
      console.log(`\n▸ API route authorization (${appUrl})`);
      const cookieFor = async (s: { c: SupabaseClient }) => {
        const { data } = await s.c.auth.getSession();
        const jar = new Map<string, string>();
        const ssr = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) } });
        await ssr.auth.setSession({ access_token: data.session!.access_token, refresh_token: data.session!.refresh_token });
        return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
      };
      const post = (path: string, body: unknown, cookie?: string) =>
        fetch(appUrl + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
      check("anonymous admin call → 401", (await post("/api/admin", { action: "set_verified", user_id: maya.id, value: false })).status === 401);
      const sofiaCookie = await cookieFor(sofia);
      check("creator calling admin API → 403", (await post("/api/admin", { action: "set_verified", user_id: sofia.id, value: true }, sofiaCookie)).status === 403);
      check("creator calling AI brief builder → 403", (await post("/api/ai/brief", { prompt: "a creator trying to use brand tools" }, sofiaCookie)).status === 403);
      const adminCookie = await cookieFor(adm);
      check("admin with malformed action → 400 (authorized, validated)", (await post("/api/admin", { action: "drop_tables" }, adminCookie)).status === 400);
      check("anonymous link-preview → 401", (await fetch(`${appUrl}/api/link-preview?url=https://youtube.com`)).status === 401);
    }
  } finally {
    await adminApi.auth.admin.deleteUser(fresh.id);
    await adminApi.from("conversations").delete().like("dm_key", `%${fresh.id}%`);
    console.log("\n  (cleaned up the throwaway accounts)");
  }

  console.log(`\n${failures ? "✗" : "✓"} ${passes} passed, ${failures} failed\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
