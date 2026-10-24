"use client";

import { usePathname } from "next/navigation";
import { StarfieldCanvas, type StarfieldProps } from "./starfield-canvas";
import { OrbitLines } from "./ornaments";

export type SkyArea = "landing" | "auth" | "app" | "admin";

/**
 * One place to tune effect intensity per area. Landing: rich. Auth/onboarding: medium.
 * Creator/brand app: low (sparse, slow, dim). Admin: minimal (still, sparse, no orbits).
 */
export const SKY: Record<SkyArea, StarfieldProps & { nebula: number; orbits: boolean }> = {
  landing: { density: 2.2, drift: 7, twinkle: 0.6, parallax: 18, meteors: true, brightness: 1, fps: 60, nebula: 1, orbits: false },
  auth: { density: 1.5, drift: 5, twinkle: 0.5, parallax: 10, brightness: 0.9, fps: 30, nebula: 0.85, orbits: true },
  app: { density: 0.9, drift: 2.5, twinkle: 0.35, brightness: 0.65, fps: 24, nebula: 0.6, orbits: true },
  admin: { density: 0.5, still: true, twinkle: 0, brightness: 0.45, nebula: 0.35, orbits: false },
};

export function skyArea(pathname: string): SkyArea {
  if (pathname === "/") return "landing";
  if (/^\/(login|signup|onboarding|auth|verify|verify-company)(\/|$)/.test(pathname)) return "auth";
  if (pathname.startsWith("/admin")) return "admin";
  return "app";
}

/** Fixed night-sky backdrop behind every page: nebula washes (CSS), a starfield (canvas) and faint orbit line-art. */
export function Atmosphere() {
  const area = skyArea(usePathname() ?? "/");
  const { nebula, orbits, ...stars } = SKY[area];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-bg via-bg to-bg-2" />
      <div
        className="absolute inset-0"
        style={{
          opacity: nebula,
          background:
            "radial-gradient(60vmax 45vmax at 12% -8%, var(--nebula-1), transparent 70%)," +
            "radial-gradient(55vmax 40vmax at 100% 30%, var(--nebula-2), transparent 70%)," +
            "radial-gradient(45vmax 35vmax at 40% 115%, var(--nebula-3), transparent 70%)",
        }}
      />
      <StarfieldCanvas key={area} {...stars} />
      {orbits && <OrbitLines className="fx-decor absolute -right-40 -top-40 size-[44rem] text-ink opacity-[0.05] dark:opacity-[0.07]" />}
    </div>
  );
}
