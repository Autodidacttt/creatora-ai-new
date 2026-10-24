import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { rateLimited } from "@/lib/rate-limit";
import { DiscoveryDisabled, discoverContacts, type FoundContact } from "@/lib/verification/contact-discovery";

export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Find official contacts" (admin, advisory). Gemini with search grounding when AI_CONTACT_DISCOVERY_ENABLED;
 * otherwise — or when it finds nothing — the demo company directory ("Demo source, simulated").
 * Only company-level data is sent; the applicant's personal data never is.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession(["admin"]);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (rateLimited(`discover:${auth.session.profile.id}`, 6)) return NextResponse.json({ error: "Too many searches — wait a minute." }, { status: 429 });
  const { data: c, error } = await (await getServerClient()).rpc("admin_get_company_verification", { p_id: id });
  if (error || !c) return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  const company = c as { company_name: string; website_domain: string; industry: string | null; address: string };

  const admin = getAdminClient();
  const started = Date.now();
  let found: FoundContact[] = [];
  let note = "";
  let source: "gemini" | "demo_directory" = "gemini";
  try {
    const r = await discoverContacts({ company_name: company.company_name, website_domain: company.website_domain, industry: company.industry, address: company.address });
    found = r.contacts;
    note = r.note;
    await admin.from("ai_job_logs").insert({ job: "contact_discovery", status: "done", duration_ms: Date.now() - started, message: `company ${id} · ${found.length} sourced contact(s) · ${r.model}` });
  } catch (err) {
    const disabled = err instanceof DiscoveryDisabled;
    note = disabled ? err.message : "The AI search failed — showing the demo directory instead.";
    if (!disabled) {
      await admin.from("ai_job_logs").insert({ job: "contact_discovery", status: "failed", duration_ms: Date.now() - started, message: String((err as Error)?.message ?? err).slice(0, 300) });
    }
  }
  if (!found.length) {
    source = "demo_directory";
    const domain = company.website_domain.replace(/^www\./, "");
    const { data: demo } = await admin.from("demo_company_directory").select("name, role, public_business_email, source_url, source_title, note").eq("domain", domain);
    found = (demo ?? []).map((d) => ({ ...d, source: "demo_directory" as const }));
    note = found.length ? `${note ? `${note} ` : ""}Demo source, simulated.` : `${note ? `${note} ` : ""}No reliable contact found. Add one manually.`;
  }
  if (found.length) {
    await admin.from("company_contact_suggestions").insert(found.map((f) => ({
      company_verification_id: id, source: f.source, name: f.name, role: f.role, source_url: f.source_url,
      source_title: f.source_title, public_business_email: f.public_business_email, note: f.note,
    })));
  }
  await admin.from("audit_logs").insert({
    actor_id: auth.session.profile.id, action: "company_contact_discovery", target_type: "company_verification", target_id: id,
    meta: { source, count: found.length },
  });
  return NextResponse.json({ source, count: found.length, note });
}
