import "server-only";
import { pepperedHash, sameHash, sixDigitCode } from "./crypto";
import { verificationSettings } from "./settings";

/**
 * One-time-code provider. DEMO: the code is generated here, stored only as a hash, and returned to the UI
 * ("Demo OTP, no SMS sent"). TWILIO_VERIFY: Twilio sends and checks the code (real SMS).
 */
export interface OtpProvider {
  method: "demo" | "twilio_verify";
  send(phone: string, challengeId: string): Promise<{ codeHash: string | null; demoCode: string | null }>;
  check(phone: string, challengeId: string, code: string, codeHash: string | null): Promise<boolean>;
}

const codeHash = (challengeId: string, code: string) => pepperedHash("otp", `${challengeId}:${code}`);

const demo: OtpProvider = {
  method: "demo",
  async send(_phone, challengeId) {
    const code = sixDigitCode();
    return { codeHash: codeHash(challengeId, code), demoCode: code };
  },
  async check(_phone, challengeId, code, stored) {
    return !!stored && sameHash(codeHash(challengeId, code), stored);
  },
};

const twilio: OtpProvider = {
  method: "twilio_verify",
  async send(phone) {
    await twilioCall("Verifications", { To: phone, Channel: "sms" });
    return { codeHash: null, demoCode: null };
  },
  async check(phone, _challengeId, code) {
    const res = (await twilioCall("VerificationCheck", { To: phone, Code: code })) as { status?: string };
    return res.status === "approved";
  },
};

async function twilioCall(path: string, body: Record<string, string>) {
  const sid = process.env.TWILIO_ACCOUNT_SID!, token = process.env.TWILIO_AUTH_TOKEN!, service = process.env.TWILIO_VERIFY_SERVICE_SID!;
  const res = await fetch(`https://verify.twilio.com/v2/Services/${service}/${path}`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && path === "Verifications") throw new Error("The SMS provider couldn't send a code — try again shortly.");
  return json;
}

export const otpProvider = (): OtpProvider => (verificationSettings().otpMode === "twilio_verify" ? twilio : demo);
