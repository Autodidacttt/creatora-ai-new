import Link from "next/link";
import { Wordmark } from "@/components/layout/top-bar";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col px-4 py-6">
      <div aria-hidden className="pointer-events-none fixed left-1/2 top-[45%] -z-[5] size-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(var(--glow-rgb),0.09),var(--nebula-1)_40%,transparent_68%)]" />
      <Link href="/" className="mx-auto mb-8 rounded-full sm:mx-0 sm:ml-4" aria-label="Creatora home">
        <Wordmark />
      </Link>
      <div className="mx-auto flex w-full max-w-md flex-1 items-start sm:items-center">{children}</div>
    </div>
  );
}
