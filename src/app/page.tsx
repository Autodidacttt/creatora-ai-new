import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ScrollStoryLazy } from "@/components/landing/story/story-lazy";
import { LiveStats } from "@/components/landing/live-stats";
import { LandingFooter, LandingNav } from "@/components/landing/landing-chrome";

export const dynamic = "force-dynamic";

/** Landing: the sticky scroll story (client-only, code-split), then live stats and the join/footer section. */
export default async function Landing() {
  if (await getSession()) redirect("/home");
  return (
    <>
      <LandingNav />
      <main id="main">
        <ScrollStoryLazy />
        <LiveStats />
        <LandingFooter />
      </main>
    </>
  );
}
