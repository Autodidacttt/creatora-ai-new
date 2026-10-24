"use client";

import { usePathname } from "next/navigation";
import { StarfieldCanvas, type StarfieldProps } from "./starfield-canvas";
import { OrbitLines } from "./ornaments";

export type SkyArea = "landing" | "auth" | "app" | "admin";

interface Sky {
  stars: StarfieldProps;
  /** Shooting-star gap range in seconds, or null for none */
  meteors: [number, number] | null;
  /** Nebula tint strength 0–1 */
  nebula: number;
  /** Faint orbit line-art in the corner */
  orbits: boolean;
}

/**
 * One place to tune effect intensity per area. Landing: rich. Auth/onboarding: medium.
 * Creator/brand app: low (sparse, slow, dim). Admin: minimal (still, sparse, no shooting stars).
 */
export const SKY: Record<SkyArea, Sky> = {
  landing: { stars: { density: 1.8, drift: 4, twinkle: 0.6, parallax: 14, scrollParallax: 0.04, brightness: 1, fps: 60 }, meteors: [6, 12], nebula: 1, orbits: false },
  auth: { stars: { density: 1.4, drift: 4, twinkle: 0.5, parallax: 8, brightness: 0.9, fps: 30 }, meteors: [7, 14], nebula: 0.85, orbits: true },
  app: { stars: { density: 0.9, drift: 2, twinkle: 0.35, scrollParallax: 0.02, brightness: 0.6, fps: 30, meteorIntensity: 0.7 }, meteors: [8, 14], nebula: 0.6, orbits: true },
  admin: { stars: { density: 0.45, still: true, twinkle: 0, brightness: 0.4 }, meteors: null, nebula: 0.35, orbits: false },
};

export function skyArea(pathname: string): SkyArea {
  if (pathname === "/") return "landing";
  if (/^\/(login|signup|onboarding|auth|verify|verify-company)(\/|$)/.test(pathname)) return "auth";
  if (pathname.startsWith("/admin")) return "admin";
  return "app";
}

/** Fixed cosmic backdrop behind every page: nebula tints (CSS) and one canvas for the starfield + rare shooting stars. */
export function Atmosphere() {
  const area = skyArea(usePathname() ?? "/");
  const { stars, meteors, nebula, orbits } = SKY[area];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          opacity: nebula,
          background:
            "radial-gradient(60vmax 45vmax at 10% -10%, var(--nebula-1), transparent 70%)," +
            "radial-gradient(50vmax 40vmax at 100% 35%, var(--nebula-2), transparent 70%)," +
            "radial-gradient(45vmax 35vmax at 35% 115%, var(--nebula-3), transparent 70%)",
        }}
      />
      <StarfieldCanvas key={area} {...stars} meteors={meteors} />
      {orbits && <OrbitLines still className="fx-decor absolute -right-40 -top-40 size-[44rem] text-ink opacity-[0.05]" />}
    </div>
  );
}
