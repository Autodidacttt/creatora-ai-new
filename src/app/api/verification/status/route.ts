import { after, NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { purgeExpiredIdImages } from "@/lib/verification/identity";
import { verificationSettings } from "@/lib/verification/settings";
import { SAMPLE_IDENTITIES } from "@/config/verification";

/** The signed-in user's own verification status (no sensitive values) + the demo-mode flags for the UI. */
export async function GET() {
  const auth = await apiSession();
  if ("error" in auth) return auth.error;
  const db = await getServerClient();
  const { data, error } = await db.rpc("get_my_verification");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const s = verificationSettings();
  // Retention runs opportunistically (at most every 10 minutes per instance)
  after(async () => { await purgeExpiredIdImages(getAdminClient()).catch(() => undefined); });
  return NextResponse.json({
    ...(data as object),
    config: {
      otp_mode: s.otpMode,
      demo_id_notice: s.demoIdNotice,
      sample_identities: s.demoIdNotice ? SAMPLE_IDENTITIES : [],
      retention_days: s.retentionDays,
    },
  }, { headers: { "cache-control": "no-store" } });
}
