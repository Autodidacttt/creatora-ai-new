import type { Verification } from "@/types/app";
import type { Badges } from "@/config/verification";
import { type DB, ServiceError, requireUserId, unwrap } from "./_db";

// ---------------------------------------------------------------------------
// Past work verification (the remaining evidence-based request type)
// ---------------------------------------------------------------------------
export async function getMyVerifications(db: DB): Promise<Verification[]> {
  const userId = await requireUserId(db);
  const rows = unwrap(await db.from("verifications")
    .select("id, type, title, status, evidence_url, evidence_notes, experience_id, reviewed_at, created_at")
    .eq("creator_id", userId).eq("type", "past_work").order("created_at", { ascending: false }));
  return rows as Verification[];
}

export async function requestPastWorkVerification(db: DB, values: { title: string; experience_id: string; evidence_url?: string | null; evidence_notes?: string | null }) {
  const userId = await requireUserId(db);
  unwrap(await db.from("verifications").insert({
    creator_id: userId, type: "past_work", title: values.title, experience_id: values.experience_id,
    evidence_url: values.evidence_url ?? null, evidence_notes: values.evidence_notes ?? null,
  }));
}

export async function withdrawVerification(db: DB, id: string) {
  unwrap(await db.from("verifications").delete().eq("id", id));
}

// ---------------------------------------------------------------------------
// Phone / ID / company (server routes; sensitive values never come back to the browser)
// ---------------------------------------------------------------------------
export type MyVerification = {
  role: "creator" | "brand" | "admin";
  brand_type: "individual" | "company" | null;
  phone: { verified: true; masked: string; method: "demo" | "twilio_verify"; verified_at: string } | null;
  identity: { status: "pending" | "verified" | "rejected"; reason: string | null; submitted_at: string; reviewed_at: string | null; mock_result: string | null } | null;
  identity_verified: boolean;
  identity_attempts_left: number;
  company: { status: "pending" | "verified" | "rejected"; company_name: string; submitted_at: string; reviewed_at: string | null; domain_match: boolean; reason: string | null } | null;
  company_verified: boolean;
  verification_required: boolean;
  can_operate: boolean;
  config: { otp_mode: "demo" | "twilio_verify"; demo_id_notice: boolean; sample_identities: { name: string; id_number: string; dob: string }[]; retention_days: number };
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ServiceError(json.error ?? "Request failed");
  return json;
}
const postJson = <T,>(url: string, body: unknown) => call<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const getMyVerification = () => call<MyVerification>("/api/verification/status");
export const startPhoneVerification = (phone: string) =>
  postJson<{ challenge_id: string; method: string; masked: string; expires_in: number; resend_in: number; demo_code?: string; demo_label?: string }>(
    "/api/verification/phone/start", { phone });
export const checkPhoneCode = (challengeId: string, code: string) =>
  postJson<{ verified: true; masked: string }>("/api/verification/phone/check", { challenge_id: challengeId, code });
export const submitIdentityVerification = (form: FormData) => call<{ id: string; status: string }>("/api/verification/identity", { method: "POST", body: form });
export const submitCompanyVerification = (values: Record<string, string>) =>
  postJson<{ id: string; domain_match: boolean; free_mail: boolean }>("/api/verification/company", values);

export async function setBrandType(db: DB, type: "individual" | "company") {
  unwrap(await db.rpc("set_brand_type", { p_type: type }));
}

// ---------------------------------------------------------------------------
// Admin queue
// ---------------------------------------------------------------------------
export type MiniUser = { id: string; username: string; display_name: string; avatar_url: string | null; is_verified: boolean; role: string; company_name: string | null; badges?: Badges };
export type IdentityRow = { id: string; kind: "creator" | "recruiter"; status: string; full_name: string; id_type: string; id_last4: string; created_at: string; reviewed_at: string | null; mock_result: string | null; user: MiniUser };
export type CompanyRow = { id: string; status: string; company_name: string; website_domain: string; applicant_name: string; applicant_role: string; domain_match: boolean; free_mail: boolean; rejection_source: string | null; created_at: string; invitation: { status: string; expires_at: string } | null; user: MiniUser };

export async function listIdentityVerifications(db: DB, kind: "creator" | "recruiter", status: string | null, query: string, page: number, size = 20) {
  const rows = unwrap(await db.rpc("admin_list_identity_verifications", { p_kind: kind, p_status: status as string, p_query: (query || null) as unknown as string, p_limit: size, p_offset: page * size }));
  return { items: rows.map((r) => r.item as unknown as IdentityRow), total: Number(rows[0]?.total_count ?? 0) };
}
export async function listCompanyVerifications(db: DB, status: string | null, query: string, page: number, size = 20) {
  const rows = unwrap(await db.rpc("admin_list_company_verifications", { p_status: status as string, p_query: (query || null) as unknown as string, p_limit: size, p_offset: page * size }));
  return { items: rows.map((r) => r.item as unknown as CompanyRow), total: Number(rows[0]?.total_count ?? 0) };
}
export const getIdentityVerification = async (db: DB, id: string) => unwrap(await db.rpc("admin_get_identity_verification", { p_id: id })) as unknown as IdentityDetail;
export const getCompanyVerification = async (db: DB, id: string) => unwrap(await db.rpc("admin_get_company_verification", { p_id: id })) as unknown as CompanyDetail;
export async function decideIdentity(db: DB, id: string, decision: "verified" | "rejected", reason?: string) {
  unwrap(await db.rpc("admin_decide_identity", { p_id: id, p_decision: decision, p_reason: (reason ?? null) as unknown as string }));
}
export async function decideCompany(db: DB, id: string, decision: "verified" | "rejected", reason?: string) {
  unwrap(await db.rpc("admin_decide_company", { p_id: id, p_decision: decision, p_reason: (reason ?? null) as unknown as string }));
}
export async function addCompanyContact(db: DB, companyId: string, c: { name: string; role: string; email: string; source_url: string; note: string }) {
  unwrap(await db.rpc("admin_add_contact", { p_company: companyId, p_name: c.name, p_role: c.role, p_email: c.email, p_source_url: c.source_url, p_note: c.note }));
}
export const viewIdImage = (id: string) => call<{ url: string }>(`/api/admin/verifications/identity/${id}/image`);
export const revealPhone = (kind: "identity" | "company", id: string) => call<{ phone: string }>(`/api/admin/verifications/${kind}/${id}/phone`);
export const findCompanyContacts = (id: string) => postJson<{ source: string; count: number; note: string }>(`/api/admin/verifications/company/${id}/discover`, {});
export const inviteCompanyContact = (id: string, c: { suggestion_id: string | null; name: string; role: string; email: string }) =>
  postJson<{ mode: "demo" | "live"; expires_at: string; link?: string; demo_label?: string }>(`/api/admin/verifications/company/${id}/invite`, c);

export type AuditEntry = { action: string; at: string; actor: MiniUser | null; meta?: Record<string, unknown> };
export type IdentityDetail = {
  id: string; kind: "creator" | "recruiter"; status: string; full_name: string; id_type: string; id_last4: string; dob: string;
  has_image: boolean; image_deleted_at: string | null; consent_at: string; reason: string | null; reviewed_at: string | null;
  reviewed_by: MiniUser | null; delete_after: string | null; created_at: string;
  mock_check: { result: string; label: string; checked_at: string; latency_ms: number } | null;
  user: MiniUser & Badges; phone: { masked: string; method: string; verified_at: string; same_number: boolean } | null;
  history: { id: string; status: string; created_at: string; reviewed_at: string | null; reason: string | null }[]; log: AuditEntry[];
};
export type Suggestion = { id: string; source: "gemini" | "demo_directory" | "manual"; name: string | null; role: string; source_url: string | null; source_title: string | null; public_business_email: string | null; note: string | null; selected: boolean; created_at: string };
export type Invitation = { id: string; contact_name: string | null; contact_role: string | null; contact_email: string; email_mode: string; status: string; expires_at: string; responded_at: string | null; comment: string | null; created_at: string };
export type CompanyDetail = {
  id: string; status: string; company_name: string; website: string; website_domain: string; company_email: string; email_domain: string;
  registration_number: string | null; address: string; industry: string | null; applicant_name: string; applicant_role: string; relationship: string;
  domain_match: boolean; free_mail: boolean; rejection_source: string | null; reason: string | null; reviewed_at: string | null; created_at: string;
  user: MiniUser & Badges; reviewed_by: MiniUser | null; phone: { masked: string; method: string; verified_at: string; same_number: boolean } | null;
  suggestions: Suggestion[]; invitations: Invitation[]; history: { id: string; status: string; created_at: string; reason: string | null }[]; log: AuditEntry[];
};
