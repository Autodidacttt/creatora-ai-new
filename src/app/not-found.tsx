import Link from "next/link";
import { PillCTA } from "@/components/ui/pill-cta";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="glass max-w-md rounded-[2rem] p-8 text-center">
        <p className="display text-6xl text-amber-2">404</p>
        <h1 className="display mt-2 text-2xl">This page drifted off</h1>
        <p className="mt-2 text-sm text-ink-2">The link may be broken or the content was removed.</p>
        <div className="mt-6 flex justify-center gap-3">
          <PillCTA href="/home">Go home</PillCTA>
          <Link href="/discover" className="self-center text-sm font-semibold underline-offset-4 hover:underline">Discover creators</Link>
        </div>
      </div>
    </div>
  );
}
