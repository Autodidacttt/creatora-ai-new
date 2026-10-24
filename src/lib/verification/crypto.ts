// Hashing / encryption for verification data. Used by server routes and the seed script (no "server-only" import);
// never import it from client components.
//
// One secret (IDENTITY_SECRET) is stretched into separate keys per purpose. If it isn't set, the keys are derived
// from SUPABASE_SECRET_KEY so the feature works out of the box — set IDENTITY_SECRET before rotating that key,
// otherwise existing phone hashes / encrypted numbers can no longer be matched or read.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

function baseSecret(): string {
  const s = process.env.IDENTITY_SECRET || process.env.SUPABASE_SECRET_KEY;
  if (!s) throw new Error("IDENTITY_SECRET (or SUPABASE_SECRET_KEY) is not configured");
  return s;
}
const keys = new Map<string, Buffer>();
function key(purpose: string): Buffer {
  let k = keys.get(purpose);
  if (!k) {
    k = Buffer.from(hkdfSync("sha256", baseSecret(), "creatora-identity", purpose, 32));
    keys.set(purpose, k);
  }
  return k;
}

/** Peppered hash (HMAC-SHA256, hex): equal inputs → equal hashes, but not reversible without the server secret. */
export const pepperedHash = (purpose: "phone" | "id_number" | "otp" | "ip" | "invite", value: string) =>
  createHmac("sha256", key(`hash:${purpose}`)).update(value).digest("hex");

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** AES-256-GCM → "v1.<iv>.<tag>.<data>" (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key("encrypt:v1"), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function decrypt(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unreadable value");
  const d = createDecipheriv("aes-256-gcm", key("encrypt:v1"), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

export const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const urlToken = () => randomBytes(32).toString("base64url");
export const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * E.164 normalisation: keeps digits, honours a leading "+" / "00"; a bare 10-digit national number gets
 * DEFAULT_PHONE_COUNTRY_CODE (default +91). Returns null if it can't be a valid number (8–15 digits).
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  let digits = raw.replace(/[^\d]/g, "");
  if (raw.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.length === 10) {
    digits = (process.env.DEFAULT_PHONE_COUNTRY_CODE ?? "+91").replace(/[^\d]/g, "") + digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = (process.env.DEFAULT_PHONE_COUNTRY_CODE ?? "+91").replace(/[^\d]/g, "") + digits.slice(1);
  } else {
    return null;
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}
export const maskPhone = (e164: string) => `${e164.slice(0, Math.min(3, e164.length - 4))}${"•".repeat(Math.max(e164.length - 7, 2))}${e164.slice(-4)}`;

/** ID number normalisation for hashing / matching: case, whitespace and punctuation don't matter. */
export const normalizeIdNumber = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const normalizeName = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
