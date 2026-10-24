import { NextResponse } from "next/server";
import { z } from "zod";
import { apiSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { rateLimited } from "@/lib/rate-limit";
import { domainCheck } from "@/lib/verification/domain";

const body = z.object({
  company_name: z.string().trim().min(2, "Enter the company name").max(160),
  website: z.string().trim().max(300).transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`)).pipe(z.string().url("Enter the company website")),
  company_email: z.string().trim().toLowerCase().email("Enter your company email").max(254),
  registration_number: z.string().trim().max(80).optional().default(""),
  address: z.string().trim().min(5, "Enter the company address").max(400),
  industry: z.string().trim().max(80).optional().default(""),
  applicant_name: z.string().trim().min(2, "Enter your name").max(120),
  applicant_role: z.string().trim().min(2, "Enter your designation / role").max(120),
  relationship: z.string().trim().min(2, "Describe your relationship with the company").max(300),
});

/** Company / Organization verification request (needs a verified phone; admins + the company contact decide). */
export async function POST(request: Request) {
  const auth = await apiSession(["brand"]);
  if ("error" in auth) return auth.error;
  const me = auth.session.profile.id;
  if (rateLimited(`company-submit:${me}`, 3)) return NextResponse.json({ error: "Too many submissions — wait a minute." }, { status: 429 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form" }, { status: 400 });
  const f = parsed.data;
  const check = domainCheck(f.website, f.company_email);
  const { data: id, error } = await getAdminClient().rpc("verification_submit_company", {
    p_user: me, p_company_name: f.company_name, p_website: f.website, p_website_domain: check.website_domain,
    p_company_email: f.company_email, p_email_domain: check.email_domain, p_registration: f.registration_number,
    p_address: f.address, p_industry: f.industry, p_applicant_name: f.applicant_name, p_applicant_role: f.applicant_role,
    p_relationship: f.relationship, p_domain_match: check.domain_match, p_free_mail: check.free_mail,
  });
  if (error || !id) {
    if (error?.code === "23505") return NextResponse.json({ error: "Your company verification is already under review." }, { status: 409 });
    return NextResponse.json({ error: error?.message ?? "Couldn't submit." }, { status: error?.code === "42501" ? 403 : 400 });
  }
  return NextResponse.json({ id, status: "pending", domain_match: check.domain_match, free_mail: check.free_mail });
}
