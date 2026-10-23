// End-to-end checks for negotiated hiring (accepted offer = agreement → Hire → Fund), published-only shortlists,
// creator targets and collaborators (0022 + 0023),
// against your Supabase project through the public API (publishable key + RPCs, exactly what the app calls).
// Throwaway brand + creator accounts; everything they create is deleted at the end.
// Usage: npm run test:hiring
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";
import { DEMO_PASSWORD, brands } from "../seed/data/accounts";

const URL_ = requireEnv("SUPABASE_URL");
const PUB = requireEnv("SUPABASE_PUBLISHABLE_KEY");
const SECRET = requireEnv("SUPABASE_SECRET_KEY");

let passes = 0, failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passes++; else failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

interface Session { c: SupabaseClient; id: string }
async function signIn(email: string, password: string): Promise<Session> {
  const c = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return { c, id: data.user.id };
}

async function main() {
  const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  const stamp = Date.now();
  const pw = `Hire-${stamp}-Aa1!`;
  const created: string[] = [];
  const mk = async (role: "brand" | "creator", tag: string) => {
    const email = `hire-${tag}-${stamp}@example.com`;
    const r = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { role, display_name: `Hire ${tag}` } });
    if (r.error || !r.data.user) throw new Error(r.error?.message);
    created.push(r.data.user.id);
    return signIn(email, pw);
  };
  const ok = <T,>(r: { data: T; error: { message: string } | null }, what: string): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data;
  };
  const terms = { deliverables: "3 vertical reels (9:16, 15s)", deadline: "2026-12-15", usage_rights: ["organic_social", "paid_social"] };

  try {
    const brand = await mk("brand", "brand");
    const creators: Session[] = [];
    for (let i = 1; i <= 7; i++) creators.push(await mk("creator", `maker${i}`));
    const [c1, c2] = creators;
    const orbitone = await signIn(brands.find((b) => b.key === "orbitone")!.email, DEMO_PASSWORD);

    const camp = ok(await brand.c.from("campaigns").insert({
      brand_id: brand.id, title: "Hiring flow test brief", description: "Testing negotiated hiring end to end.", status: "draft",
      creators_needed: 5, aspect_ratios: ["9:16"], usage_rights: ["organic_social"], currency: "USD", deliverables: "Reels",
    }).select("id").single(), "create brief");
    const K = camp!.id as string;

    console.log("\n▸ Shortlist only on a published brief");
    const early = await brand.c.from("campaign_shortlists").insert({ campaign_id: K, creator_id: c1.id, added_by: brand.id });
    check("shortlisting on a draft brief is blocked", !!early.error && /Publish the brief first/.test(early.error.message), early.error?.message);
    ok(await brand.c.rpc("publish_campaign", { p_campaign: K }), "publish");
    check("…allowed after publishing", !(await brand.c.from("campaign_shortlists").insert({ campaign_id: K, creator_id: c1.id, added_by: brand.id })).error);
    const bookmark = await c1.c.from("saved_opportunities").insert({ creator_id: c1.id, campaign_id: K });
    check("plain bookmarks (save) are unaffected", !bookmark.error, bookmark.error?.message);

    console.log("\n▸ Accept the price → Hire at once → Fund project");
    const direct = await brand.c.rpc("hire_creator", { p_campaign: K, p_creator: c1.id, p_amount: 1, p_currency: "USD" });
    check("direct hire through the API is rejected", !!direct.error && /Direct hiring is disabled/.test(direct.error.message), direct.error?.message);
    check("another brand can't open a negotiation on this brief", !!(await orbitone.c.rpc("start_negotiation", { p_campaign: K, p_creator: c1.id })).error);
    const conv = ok(await brand.c.rpc("start_negotiation", { p_campaign: K, p_creator: c1.id }), "start negotiation") as string;
    check("opening the chat hires nobody", ((await admin.from("campaign_creators").select("id").eq("campaign_id", K)).data?.length ?? 0) === 0);
    const card0 = ok(await c1.c.rpc("get_negotiation", { p_conversation: conv }), "negotiation") as { state: string; campaign: { title: string } };
    check("creator sees the pinned brief card", card0.state === "open" && card0.campaign.title === "Hiring flow test brief");
    check("no hire without an accepted offer", !!(await brand.c.rpc("hire_creator", { p_proposal: conv })).error);
    const o1 = ok(await brand.c.rpc("send_offer", { p_conversation: conv, p_price: 900, p_terms: terms }), "offer") as string;
    const o2 = ok(await c1.c.rpc("send_offer", { p_conversation: conv, p_price: 1300, p_terms: terms }), "counter") as string;
    check("countered offer can no longer be accepted", !!(await c1.c.rpc("accept_offer", { p_message: o1 })).error);
    check("you can't accept your own offer", !!(await c1.c.rpc("accept_offer", { p_message: o2 })).error);
    check("outsiders can't read the negotiation", ((await c2.c.from("messages").select("id").eq("conversation_id", conv)).data?.length ?? 0) === 0);
    const p1 = ok(await brand.c.rpc("accept_offer", { p_message: o2 }), "accept counter") as string;
    const n1 = ok(await brand.c.rpc("get_negotiation", { p_conversation: conv }), "neg") as { state: string; proposal: { id: string; status: string; terms: Record<string, unknown> } };
    check("accepting the creator's price is the agreement (Hire available at once)", n1.state === "agreed" && n1.proposal.id === p1 && n1.proposal.status === "accepted");
    check("agreed terms carry no 'revisions'", !("revisions" in n1.proposal.terms));
    check("the final-proposal step is gone", !!(await c1.c.rpc("send_final_proposal" as never, { p_conversation: conv, p_note: null } as never)).error);
    check("creator can't hire themselves", !!(await c1.c.rpc("hire_creator", { p_proposal: p1 })).error);
    const project1 = ok(await brand.c.rpc("hire_creator", { p_proposal: p1 }), "hire") as string;
    const row = (await admin.from("campaign_creators").select("status, agreed_amount").eq("id", project1).single()).data;
    const esc = (await admin.from("escrow_payments").select("status, amount").eq("campaign_creator_id", project1).single()).data;
    check("Hire → awaiting funding at the agreed price", row?.status === "awaiting_funding" && row.agreed_amount === 1300, JSON.stringify(row));
    check("demo escrow pending at that price", esc?.status === "unfunded" && esc.amount === 1300, JSON.stringify(esc));
    const blocked = await c1.c.rpc("create_submission", { p_project: project1 });
    check("unfunded hire: creator can't submit (API)", !!blocked.error && /awaiting funding/.test(blocked.error.message), blocked.error?.message);
    check("unfunded hire: brand can't assign tasks (API)", !!(await brand.c.rpc("create_campaign_task", { p_campaign: K, p_title: "Too early", p_description: null, p_due_date: null, p_assignee: c1.id })).error);
    check("unfunded hire isn't a collaborator", (ok(await brand.c.rpc("get_campaign", { p_id: K }), "card") as { stats: { selected: number } }).stats.selected === 0);
    check("brand is reminded to fund", ((await brand.c.from("notifications").select("id").eq("type", "project").eq("entity_id", project1)).data ?? []).length >= 1);
    check("creator can't fund", !!(await c1.c.rpc("fund_escrow", { p_project: project1 })).error);
    ok(await brand.c.rpc("fund_escrow", { p_project: project1 }), "fund");
    check("Fund project → in progress, escrow funded", (await admin.from("campaign_creators").select("status").eq("id", project1).single()).data?.status === "in_progress"
      && (await admin.from("escrow_payments").select("status").eq("campaign_creator_id", project1).single()).data?.status === "funded");
    check("creator unblocked: can create a submission", !(await c1.c.rpc("create_submission", { p_project: project1 })).error);
    const notes = (await c1.c.from("notifications").select("type, data").in("type", ["proposal", "project", "payment"])).data ?? [];
    const events = notes.map((n) => (n.data as { event: string }).event);
    check("creator notified at each step", ["negotiation_opened", "offer", "offer_accepted", "awaiting_funding", "funded", "in_progress"].every((e) => events.includes(e)), events.join(","));

    console.log("\n▸ A counter-offer after acceptance voids the agreement");
    const cv7 = ok(await brand.c.rpc("start_negotiation", { p_campaign: K, p_creator: creators[6].id }), "negotiate 7") as string;
    const o7 = ok(await brand.c.rpc("send_offer", { p_conversation: cv7, p_price: 500, p_terms: terms }), "offer 7") as string;
    const p7 = ok(await creators[6].c.rpc("accept_offer", { p_message: o7 }), "accept 7") as string;
    check("creator accepting the brand's offer → brand told to hire", ((await brand.c.from("notifications").select("data").eq("type", "proposal")).data ?? []).some((n) => (n.data as { event: string; proposal_id?: string }).event === "offer_accepted_hire" && (n.data as { proposal_id?: string }).proposal_id === p7));
    ok(await creators[6].c.rpc("send_offer", { p_conversation: cv7, p_price: 650, p_terms: terms }), "counter 7");
    check("the new offer voids the agreement", !!(await brand.c.rpc("hire_creator", { p_proposal: p7 })).error);
    check("back to negotiating", (ok(await brand.c.rpc("get_negotiation", { p_conversation: cv7 }), "neg 7") as { state: string }).state === "negotiating");
    const apps = ok(await brand.c.rpc("get_campaign_applications", { p_campaign: K }), "applications");
    check("applications read model still works", Array.isArray(apps));

    console.log("\n▸ Collaborators: hire 1 → 2 → 6 on a brief set to 5");
    const hire = async (s: Session, price: number) => {
      const cv = ok(await brand.c.rpc("start_negotiation", { p_campaign: K, p_creator: s.id }), "negotiate") as string;
      const off = ok(await s.c.rpc("send_offer", { p_conversation: cv, p_price: price, p_terms: terms }), "offer") as string;
      const pr = ok(await brand.c.rpc("accept_offer", { p_message: off }), "accept") as string;
      const pj = ok(await brand.c.rpc("hire_creator", { p_proposal: pr }), "hire") as string;
      ok(await brand.c.rpc("fund_escrow", { p_project: pj }), "fund");
      return pj;
    };
    const groups = async () => (await admin.from("conversations").select("id").eq("campaign_id", K).eq("type", "group")).data ?? [];
    check("no group chat with one collaborator", (await groups()).length === 0);
    await hire(c2, 1000);
    const g = await groups();
    check("group chat created when the 2nd creator is hired", g.length === 1);
    for (const s of creators.slice(2, 6)) await hire(s, 800);
    check("still exactly one group chat after 6 hires", (await groups()).length === 1);
    const members = (await admin.from("conversation_participants").select("user_id").eq("conversation_id", g[0].id)).data ?? [];
    check("group = brand + all 6 creators", members.length === 7 && members.some((m) => m.user_id === brand.id));
    const card = ok(await brand.c.rpc("get_campaign", { p_id: K }), "card") as { stats: { selected: number }; creators_needed: number };
    check("hiring past the target works: 6 hired on a target of 5", card.stats.selected === 6 && card.creators_needed === 5, JSON.stringify(card.stats));
    const collab = ok(await brand.c.rpc("get_campaign_collaborators", { p_campaign: K }), "collaborators") as { count: number; members: unknown[]; group_conversation_id: string };
    check("collaborators panel counts 6 with a group link", collab.count === 6 && collab.members.length === 6 && collab.group_conversation_id === g[0].id);
    const groupInbox = ok(await c2.c.rpc("get_inbox", { p_other_role: null, p_query: null, p_limit: 30, p_offset: 0 }), "inbox") as { conversation_type: string }[];
    check("a creator's inbox shows the group once", groupInbox.filter((r) => r.conversation_type === "group").length === 1);
    const lower = await brand.c.from("campaigns").update({ creators_needed: 3 }).eq("id", K);
    check("target can't drop below the 6 hired", !!lower.error);
    check("target can be raised any time", !(await brand.c.from("campaigns").update({ creators_needed: 10 }).eq("id", K)).error);
    const p6 = (await admin.from("campaign_creators").select("id").eq("campaign_id", K).eq("creator_id", creators[5].id).single()).data!.id as string;
    ok(await brand.c.rpc("cancel_project", { p_project: p6, p_reason: "Scope changed" }), "cancel");
    const after = (await admin.from("conversation_participants").select("user_id").eq("conversation_id", g[0].id)).data ?? [];
    check("removed creator leaves the group", after.length === 6 && !after.some((m) => m.user_id === creators[5].id));

    console.log("\n▸ Tasks: one creator and the whole group");
    const t1 = ok(await brand.c.rpc("create_campaign_task", { p_campaign: K, p_title: "Storyboard", p_description: "First pass", p_due_date: "2026-11-30", p_assignee: c1.id }), "task 1") as string;
    const t2 = ok(await brand.c.rpc("create_campaign_task", { p_campaign: K, p_title: "Kick-off call", p_description: null, p_due_date: null, p_assignee: null }), "task 2") as string;
    check("individual task posted in the creator's chat", ((await admin.from("messages").select("id").eq("conversation_id", conv).eq("kind", "task")).data?.length ?? 0) === 1);
    check("group task posted in the group chat", ((await admin.from("messages").select("id").eq("conversation_id", g[0].id).eq("kind", "task")).data?.length ?? 0) === 1);
    check("assignee sees their task", ((await c1.c.from("campaign_tasks").select("id").eq("id", t1)).data?.length ?? 0) === 1);
    check("other creators don't see someone else's task", ((await c2.c.from("campaign_tasks").select("id").eq("id", t1)).data?.length ?? 0) === 0);
    check("all collaborators see the group task", ((await c2.c.from("campaign_tasks").select("id").eq("id", t2)).data?.length ?? 0) === 1);
    check("outsiders see no tasks", ((await creators[6].c.from("campaign_tasks").select("id").eq("campaign_id", K)).data?.length ?? 0) === 0);
    check("creators can't create tasks", !!(await c1.c.rpc("create_campaign_task", { p_campaign: K, p_title: "Mine", p_description: null, p_due_date: null, p_assignee: null })).error);
    check("assignee updates their task", !(await c1.c.rpc("update_campaign_task_status", { p_task: t1, p_status: "done" })).error);
    check("another creator can't update it", !!(await c2.c.rpc("update_campaign_task_status", { p_task: t1, p_status: "todo" })).error);
    check("brand is notified of the update", ((await brand.c.from("notifications").select("id").eq("type", "task")).data?.length ?? 0) >= 1);
  } finally {
    for (const id of created) {
      await admin.from("conversations").delete().like("dm_key", `%${id}%`);
      await admin.auth.admin.deleteUser(id);
    }
    console.log("\n  (cleaned up the throwaway accounts)");
  }
  console.log(`\n${failures ? "✗" : "✓"} ${passes} passed, ${failures} failed\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
