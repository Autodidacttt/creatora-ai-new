import { requireSession } from "@/lib/auth";
import { SessionProvider } from "@/features/session";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireSession();
  return (
    <SessionProvider profile={profile}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
