import { NextResponse } from "next/server";
import { z } from "zod";
import { apiSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { rateLimited } from "@/lib/rate-limit";
import { decrypt } from "@/lib/verification/crypto";
import { otpProvider } from "@/lib/verification/otp";
import { OTP } from "@/config/verification";

const body = z.object({ challenge_id: z.string().uuid(), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });
const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/** Check the code: 5-minute expiry, 5 attempts, then the number is bound to this account (unique across accounts). */
export async function POST(request: Request) {
  const auth = await apiSession(["creator", "brand"]);
  if ("error" in auth) return auth.error;
  const me = auth.session.profile.id;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Enter the 6-digit code");
  if (rateLimited(`otp-check:${me}`, 12)) return fail("Too many attempts — wait a minute.", 429);

  const admin = getAdminClient();
  const { data: ch } = await admin.from("phone_otp_challenges").select("*").eq("id", parsed.data.challenge_id).eq("user_id", me).maybeSingle();
  if (!ch) return fail("Request a new code.", 404);
  if (ch.status === "verified") return fail("This code was already used.", 409);
  if (ch.status === "locked") return fail("Too many wrong codes. Request a new code.", 429);
  if (ch.status !== "pending") return fail("This code was replaced by a newer one.", 410);
  if (new Date(ch.expires_at).getTime() < Date.now()) {
    await admin.from("phone_otp_challenges").update({ status: "expired" }).eq("id", ch.id);
    return fail("The code expired. Request a new one.", 410);
  }
  // Count the attempt first, atomically (a parallel request can't get extra tries)
  const { data: counted } = await admin.from("phone_otp_challenges").update({ attempts: ch.attempts + 1 })
    .eq("id", ch.id).eq("attempts", ch.attempts).eq("status", "pending").select("attempts").maybeSingle();
  if (!counted) return fail("Try again.", 409);

  const phone = decrypt(ch.phone_cipher);
  const ok = await otpProvider().check(phone, ch.id, parsed.data.code, ch.code_hash).catch(() => false);
  if (!ok) {
    const left = OTP.maxAttempts - counted.attempts;
    if (left <= 0) {
      await admin.from("phone_otp_challenges").update({ status: "locked" }).eq("id", ch.id);
      return fail("Too many wrong codes. Request a new code.", 429, { attempts_left: 0 });
    }
    return fail(`That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left.`, 400, { attempts_left: left });
  }

  const { error } = await admin.rpc("verification_record_phone", {
    p_user: me, p_hash: ch.phone_hash, p_masked: ch.phone_masked, p_cipher: ch.phone_cipher, p_method: ch.method,
  });
  if (error) {
    // unique constraint: a race with another account verifying the same number
    if (error.code === "23505") return fail("This phone number is already verified on another Creatora account.", 409);
    return fail("Couldn't save the verification — try again.", 500);
  }
  await admin.from("phone_otp_challenges").update({ status: "verified" }).eq("id", ch.id);
  return NextResponse.json({ verified: true, masked: ch.phone_masked, method: ch.method });
}
