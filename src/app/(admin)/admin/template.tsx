"use client";

import { PageTransition } from "@/components/cosmic/app-open";

/** App-open transition on every navigation between admin sections: the page grows out of the pressed nav item. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
