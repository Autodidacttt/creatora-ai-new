"use client";

import { PageTransition } from "@/components/astral/interactive";

/** Soft depth transition on every navigation inside the app (opacity only for reduced effects / reduced motion). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
