import { requireSession } from "@/lib/auth";
import { SessionProvider } from "@/features/session";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireSession({ roles: ["admin"] });
  return (
    <SessionProvider profile={profile}>
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
