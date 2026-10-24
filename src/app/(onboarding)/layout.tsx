import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { SessionProvider } from "@/features/session";
import { Wordmark } from "@/components/layout/top-bar";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireSession({ allowNotOnboarded: true });
  return (
    <SessionProvider profile={profile}>
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div aria-hidden className="pointer-events-none fixed left-1/2 top-[45%] -z-[5] size-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(var(--glow-rgb),0.09),var(--nebula-1)_40%,transparent_68%)]" />
        <Link href="/home" className="mb-8 inline-block rounded-full" aria-label="Creatora"><Wordmark /></Link>
        {children}
      </div>
    </SessionProvider>
  );
}
