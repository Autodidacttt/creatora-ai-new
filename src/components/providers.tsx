"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/overlay";
import { AuthFragmentForwarder } from "@/components/auth-fragment-forwarder";
import { EffectsProvider, useEffects } from "@/components/astral/effects";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <EffectsProvider>
      <EffectsMotion>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <AuthFragmentForwarder />
          {children}
          <Toaster
            position="bottom-center"
            toastOptions={{
              className: "!rounded-2xl !border !border-glass-border !bg-glass-strong !text-ink !backdrop-blur-xl !shadow-lift",
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
      </EffectsMotion>
      </EffectsProvider>
    </ThemeProvider>
  );
}

/** Framer Motion follows the effects preference: transforms are dropped for "reduced"/"off" (and for OS reduced motion). */
function EffectsMotion({ children }: { children: ReactNode }) {
  const { level } = useEffects();
  return <MotionConfig reducedMotion={level === "full" ? "user" : "always"}>{children}</MotionConfig>;
}
