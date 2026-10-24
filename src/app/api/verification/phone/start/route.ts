import { NextResponse } from "next/server";
import { z } from "zod";
import { apiSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { rateLimited } from "@/lib/rate-limit";
import { encrypt, maskPhone, normalizePhone, pepperedHash } from "@/lib/verification/crypto";
import { otpProvider } from "@/lib/verification/otp";
import { clientIp } from "@/lib/verification/settings";
import { OTP } from "@/config/verification";

const body = z.object({ phone: z.string().min(6).max(24) });
const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/** Send (or resend) a 6-digit code. One verified number per Creatora account, across creators and brands. */
export async function POST(request: Request) {
  const auth = await apiSession(["creator", "brand"]);
  if ("error" in auth) return auth.error;
  const me = auth.session.profile.id;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Enter your phone number with the country code, e.g. +91 98765 43210.");
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return fail("That doesn't look like a valid phone number — include the country code (e.g. +91).");
  if (rateLimited(`otp-start:${me}`, 5)) return fail("Too many requests — wait a minute.", 429);

  const admin = getAdminClient();
  const phoneHash = pepperedHash("phone", phone);
  const ipHash = pepperedHash("ip", clientIp(request));
  const taken = (await admin.from("verified_phones").select("user_id").eq("phone_hash", phoneHash).maybeSingle()).data;
  if (taken && taken.user_id !== me) return fail("This phone number is already verified on another Creatora account.", 409);
  if (taken && taken.user_id === me) return fail("This number is already verified on your account.", 409);

  // Hourly limits per user, per number and per IP (stored challenges, so they hold across server instances)
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const sent = async (col: "user_id" | "phone_hash" | "ip_hash", v: string) =>
    ((await admin.from("phone_otp_challenges").select("sends").eq(col, v).gte("last_sent_at", hourAgo).limit(100)).data ?? [])
      .reduce((n, r) => n + r.sends, 0);
  const [byUser, byPhone, byIp] = await Promise.all([sent("user_id", me), sent("phone_hash", phoneHash), sent("ip_hash", ipHash)]);
  if (byUser >= OTP.perUserPerHour || byPhone >= OTP.perPhonePerHour || byIp >= OTP.perIpPerHour) {
    return fail("Too many codes requested. Try again in an hour.", 429);
  }

  const provider = otpProvider();
  // Resend on the same pending challenge (cooldown + per-challenge cap), else start a new one
  const { data: open } = await admin.from("phone_otp_challenges").select("id, sends, last_sent_at, expires_at")
    .eq("user_id", me).eq("phone_hash", phoneHash).eq("status", "pending").gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (open) {
    const wait = OTP.resendSeconds - Math.floor((Date.now() - new Date(open.last_sent_at).getTime()) / 1000);
    if (wait > 0) return fail(`Wait ${wait}s before asking for a new code.`, 429, { resend_in: wait });
    if (open.sends >= OTP.maxSendsPerChallenge) return fail("Too many codes for this number. Try again later.", 429);
  }
  await admin.from("phone_otp_challenges").update({ status: "replaced" }).eq("user_id", me).eq("status", "pending");
  const id = crypto.randomUUID();
  let delivery;
  try {
    delivery = await provider.send(phone, id);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't send the code.", 502);
  }
  const { error } = await admin.from("phone_otp_challenges").insert({
    id, user_id: me, phone_hash: phoneHash, phone_cipher: encrypt(phone), phone_masked: maskPhone(phone), method: provider.method,
    code_hash: delivery.codeHash, sends: (open?.sends ?? 0) + 1, ip_hash: ipHash,
    expires_at: new Date(Date.now() + OTP.ttlSeconds * 1000).toISOString(),
  });
  if (error) return fail("Couldn't start verification — try again.", 500);
  return NextResponse.json({
    challenge_id: id, method: provider.method, masked: maskPhone(phone), expires_in: OTP.ttlSeconds, resend_in: OTP.resendSeconds,
    ...(delivery.demoCode ? { demo_code: delivery.demoCode, demo_label: "Demo OTP, no SMS sent" } : {}),
  }, { headers: { "cache-control": "no-store" } });
}
