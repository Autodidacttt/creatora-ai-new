import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { SessionProvider } from "@/features/session";
import { Wordmark } from "@/components/layout/top-bar";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireSession({ allowNotOnboarded: true });
  return (
    <SessionProvider profile={profile}>
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Link href="/home" className="mb-8 inline-block rounded-full" aria-label="Creatora"><Wordmark /></Link>
        {children}
      </div>
    </SessionProvider>
  );
}
