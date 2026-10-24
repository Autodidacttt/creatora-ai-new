import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import { Atmosphere } from "@/components/cosmic/atmosphere";
import { EFFECTS_SCRIPT } from "@/components/cosmic/effects";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Creatora — the AI creator marketplace", template: "%s · Creatora" },
  description:
    "Discover AI filmmakers, animators and generative artists. Rich AI portfolios with tools and workflows, structured briefs, and transparent matching.",
};

export const viewport: Viewport = {
  themeColor: "#12100d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        {/* Effects preference (Settings → Appearance) applied before first paint */}
        <script dangerouslySetInnerHTML={{ __html: EFFECTS_SCRIPT }} />
        <Providers>
          <Atmosphere />
          {children}
        </Providers>
      </body>
    </html>
  );
}
