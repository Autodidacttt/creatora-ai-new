// Verification constants shared by client and server. Flags that change behaviour are read on the server
// (src/lib/verification/settings.ts); nothing here is secret.

/** FICTIONAL identities accepted by the mock government-ID API (migration 0026 seeds the same records, hashed). */
export const SAMPLE_IDENTITIES = [
  { name: "Aarav Sharma", id_number: "DEMO-100001", dob: "1995-04-12" },
  { name: "Meera Iyer", id_number: "DEMO-100002", dob: "1998-09-03" },
  { name: "Kabir Rao", id_number: "DEMO-100003", dob: "1992-01-27" },
  { name: "Sofia Marin", id_number: "DEMO-100004", dob: "1996-06-18" },
  { name: "Kenji Watanabe", id_number: "DEMO-100005", dob: "1990-11-05" },
  { name: "Lena Fischer", id_number: "DEMO-100006", dob: "1994-02-14" },
  { name: "Diego Santos", id_number: "DEMO-100007", dob: "1993-08-30" },
  { name: "Maya Okafor", id_number: "DEMO-100008", dob: "1997-12-09" },
  { name: "Arjun Mehta", id_number: "DEMO-100009", dob: "1991-03-22" },
  { name: "Priya Nair", id_number: "DEMO-100010", dob: "1999-07-01" },
] as const;

export const ID_TYPES = [
  { value: "national_id", label: "National ID card" },
  { value: "passport", label: "Passport" },
  { value: "driving_licence", label: "Driving licence" },
  { value: "voter_id", label: "Voter ID" },
  { value: "other", label: "Other government ID" },
] as const;

export const OTP = { ttlSeconds: 300, maxAttempts: 5, resendSeconds: 30, maxSendsPerChallenge: 5, perUserPerHour: 6, perPhonePerHour: 5, perIpPerHour: 20 } as const;
export const ID_IMAGE = { maxBytes: 5 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp"] } as const;
export const INVITE_DAYS = 7;

/** Free-mail providers: an applicant using one of these can't prove they belong to the company's domain. */
export const FREE_MAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com",
  "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.com", "yandex.com", "zoho.com", "rediffmail.com",
] as const;

export type Badges = { phone_verified: boolean; identity_verified: boolean; company_verified: boolean; brand_type: "individual" | "company" | null };
