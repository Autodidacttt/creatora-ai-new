import Link from "next/link";
import { Wordmark } from "@/components/layout/top-bar";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col px-4 py-6">
      <Link href="/" className="mx-auto mb-8 rounded-full sm:mx-0 sm:ml-4" aria-label="Creatora home">
        <Wordmark />
      </Link>
      <div className="mx-auto flex w-full max-w-md flex-1 items-start sm:items-center">{children}</div>
    </div>
  );
}
