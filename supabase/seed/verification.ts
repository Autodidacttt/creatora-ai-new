// Demo verification states (labelled demo): verified / pending / rejected phones, IDs and companies, plus admin
// review permissions. All identities and phone numbers are FICTIONAL. Runs right after the users exist, so demo
// brands are verified before their briefs are published (new brands can't publish until verified).
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { encrypt, maskPhone, normalizeIdNumber, pepperedHash } from "../../src/lib/verification/crypto";

type Ctx = { admin: SupabaseClient; uid: (key: string) => string; log: (m: string) => void };
const check = <T>(r: { data: T; error: { message: string } | null }, what: string) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

// Fictional numbers (unique per demo account)
const PHONES: Record<string, string> = {
  maya: "+919000000101", kenji: "+919000000102", sofia: "+919000000103", arjun: "+919000000104", diego: "+919000000105",
  atelier: "+919000000201", orbitone: "+919000000202", tidewell: "+919000000203",
};
// Matches SAMPLE_IDENTITIES / mock_identity_records (fictional)
const IDS: Record<string, { name: string; id: string; dob: string; status: "verified" | "pending" | "rejected"; reason?: string; mock: string }> = {
  maya: { name: "Maya Okafor", id: "DEMO-100008", dob: "1997-12-09", status: "verified", mock: "Identity Verified" },
  kenji: { name: "Kenji Watanabe", id: "DEMO-100005", dob: "1990-11-05", status: "verified", mock: "Identity Verified" },
  diego: { name: "Diego Santos", id: "DEMO-100007", dob: "1993-08-30", status: "pending", mock: "Identity Verified" },
  arjun: { name: "Arjun Mehta", id: "DEMO-100099", dob: "1991-03-22", status: "rejected", reason: "Demo: the ID number doesn't match the document photo.", mock: "Identity Not Verified" },
};

async function demoIdImage(name: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" rx="24" fill="#f4efe6"/>
    <text x="32" y="64" font-family="sans-serif" font-size="28" font-weight="700" fill="#2a2118">DEMO ID — FICTIONAL</text>
    <text x="32" y="120" font-family="sans-serif" font-size="22" fill="#2a2118">${name}</text>
    <text x="32" y="360" font-family="sans-serif" font-size="16" fill="#8a8478">Creatora demo data · not a real document</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

export async function seedVerification({ admin, uid, log }: Ctx) {
  // Admin review permissions
  check(await admin.from("admin_permissions").upsert(["verify_creators", "verify_brands"].map((p) => ({ user_id: uid("admin"), permission: p })),
    { onConflict: "user_id,permission" }), "admin permissions");

  const all = Object.keys(PHONES).map(uid);
  // Fresh demo state (demo accounts only)
  const old = check(await admin.from("identity_verifications").select("id_image_path").in("user_id", all), "old ids") as { id_image_path: string | null }[];
  const paths = old.map((o) => o.id_image_path).filter((p): p is string => !!p);
  if (paths.length) await admin.storage.from("identity-documents").remove(paths);
  check(await admin.from("identity_verifications").delete().in("user_id", all), "clear ids");
  check(await admin.from("company_verifications").delete().in("brand_id", all), "clear companies");

  for (const [key, phone] of Object.entries(PHONES)) {
    check(await admin.from("verified_phones").upsert({
      user_id: uid(key), phone_hash: pepperedHash("phone", phone), phone_cipher: encrypt(phone), phone_masked: maskPhone(phone),
      method: "demo", verified_at: daysAgo(20),
    }, { onConflict: "user_id" }), `phone ${key}`);
    check(await admin.from("profiles").update({ phone_verified_at: daysAgo(20) }).eq("id", uid(key)), `phone flag ${key}`);
  }

  for (const [key, v] of Object.entries(IDS)) {
    const user = uid(key);
    const idNorm = normalizeIdNumber(v.id);
    let image: string | null = null;
    if (v.status === "pending") {
      image = `${user}/demo-id.jpg`;
      check(await admin.storage.from("identity-documents").upload(image, await demoIdImage(v.name), { contentType: "image/jpeg", upsert: true }), `id image ${key}`);
    }
    const decided = v.status !== "pending";
    check(await admin.from("identity_verifications").insert({
      user_id: user, kind: "creator", status: v.status, full_name: v.name, id_type: "national_id",
      id_number_hash: pepperedHash("id_number", idNorm), id_last4: idNorm.slice(-4), dob: v.dob, id_image_path: image,
      phone_hash: pepperedHash("phone", PHONES[key]), consent_at: daysAgo(15),
      mock_check: { result: v.mock, simulated: true, label: "Simulated check, not a government verification", checked_at: daysAgo(15), latency_ms: 420 },
      reviewed_by: decided ? uid("admin") : null, reviewed_at: decided ? daysAgo(12) : null, reason: v.reason ?? null,
      delete_after: decided ? daysAgo(-18) : null, image_deleted_at: decided ? daysAgo(12) : null, created_at: daysAgo(15),
    }), `identity ${key}`);
    check(await admin.from("profiles").update({ identity_verified_at: v.status === "verified" ? daysAgo(12) : null }).eq("id", user), `identity flag ${key}`);
  }

  // Demo brands: verified companies (one had an earlier rejected attempt)
  const company = (key: string, name: string, domain: string, applicant: string, role: string, status: "verified" | "rejected", age: number, reason?: string) => ({
    brand_id: uid(key), status, company_name: name, website: `https://${domain}`, website_domain: domain,
    company_email: `${applicant.split(" ")[0].toLowerCase()}@${status === "rejected" ? "gmail.com" : domain}`,
    email_domain: status === "rejected" ? "gmail.com" : domain, address: "Demo address, not real", industry: "Demo",
    applicant_name: applicant, applicant_role: role, relationship: "Demo: employee", phone_hash: pepperedHash("phone", PHONES[key]),
    domain_match: status !== "rejected", free_mail: status === "rejected", rejection_source: status === "rejected" ? "admin" : null,
    reviewed_by: uid("admin"), reviewed_at: daysAgo(age - 1), reason: reason ?? null, created_at: daysAgo(age),
  });
  check(await admin.from("company_verifications").insert([
    company("atelier", "Atelier Nova", "ateliernova.example", "Inès Laurent", "Brand Manager", "verified", 25),
    company("orbitone", "Orbitone", "orbitone.example", "Ravi Kapoor", "Head of Marketing", "verified", 24),
    company("tidewell", "Tidewell", "tidewell.example", "Sam Okoye", "Marketing Director", "rejected", 30, "Demo: applied with a free-mail address."),
    company("tidewell", "Tidewell", "tidewell.example", "Sam Okoye", "Marketing Director", "verified", 22),
  ]), "companies");
  for (const key of ["atelier", "orbitone", "tidewell"]) {
    check(await admin.from("brand_details").update({ brand_type: "company", company_verified_at: daysAgo(21), verification_required: false }).eq("profile_id", uid(key)), `brand ${key}`);
  }
  log("  - demo verification states (phones, IDs: verified / pending / rejected, companies)");
}
