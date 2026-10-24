"use client";

import { PageTransition } from "@/components/cosmic/app-open";

/** App-open transition on every navigation inside the app: the page grows out of the pressed icon or card. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
