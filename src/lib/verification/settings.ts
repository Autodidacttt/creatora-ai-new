// Server-side verification flags (environment). Shared by routes and scripts.
import { pepperedHash } from "./crypto";

const on = (v: string | undefined, fallback: boolean) => (v === undefined || v === "" ? fallback : v === "true" || v === "1");

export function verificationSettings() {
  const twilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
  return {
    /** Real SMS only when a provider is configured and OTP_MODE isn't forced to demo */
    otpMode: (process.env.OTP_MODE === "demo" || !twilio ? "demo" : "twilio_verify") as "demo" | "twilio_verify",
    /** "Hackathon demo: use the sample IDs provided" banner + sample list on the ID form */
    demoIdNotice: on(process.env.DEMO_ID_NOTICE, true),
    emailMode: (process.env.EMAIL_SEND_MODE === "live" && process.env.RESEND_API_KEY ? "live" : "demo") as "demo" | "live",
    /** Gemini contact discovery for company verification — off unless explicitly enabled */
    contactDiscovery: on(process.env.AI_CONTACT_DISCOVERY_ENABLED, false),
    retentionDays: Number(process.env.ID_RETENTION_DAYS ?? 30) || 30,
  };
}

/** API key the app uses for its own mock government-ID service; explicit, or derived from the server secret. */
export const mockIdentityApiKey = () => process.env.MOCK_IDENTITY_API_KEY || pepperedHash("invite", "mock-identity-api-key").slice(0, 40);

/** Client IP behind Vercel's proxy (only ever stored as a peppered hash). */
export const clientIp = (r: Request) => r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || r.headers.get("x-real-ip") || "unknown";
