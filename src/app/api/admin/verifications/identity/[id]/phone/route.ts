import { revealPhone } from "@/lib/verification/admin-phone";

/** Reveals the applicant's verified phone to a permitted admin (audit-logged). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return revealPhone("identity", (await params).id);
}
