import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSession } from "@/lib/auth";
import { CreatorDashboard } from "@/components/dashboard/creator-dashboard";

export const metadata: Metadata = { title: "Creator dashboard" };

/** Creator-only. The RPCs behind it also verify ownership in Postgres (dashboard_assert). */
export default async function DashboardPage() {
  await requireSession({ roles: ["creator"] });
  return (
    <Suspense>
      <CreatorDashboard />
    </Suspense>
  );
}
