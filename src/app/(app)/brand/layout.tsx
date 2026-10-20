import { requireSession } from "@/lib/auth";

/** The brand workspace (Studio, Creative Review, Hiring & Delivery) is for brand accounts only. */
export default async function BrandLayout({ children }: { children: React.ReactNode }) {
  await requireSession({ roles: ["brand"] });
  return children;
}
