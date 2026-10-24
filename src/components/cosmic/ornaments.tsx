import { cn } from "@/lib/utils";

/**
 * Hairline rings, two tilted orbits and a few "planets" — faint line-art for backdrops. Slowly rotates (CSS,
 * effects-aware) unless `still` — keep it still behind glass panels, where every frame would re-blur them.
 */
export function OrbitLines({ className, still }: { className?: string; still?: boolean }) {
  return (
    <svg viewBox="-220 -220 440 440" className={className} fill="none" stroke="currentColor" strokeWidth="0.7" aria-hidden>
      {[60, 110, 160, 210].map((r) => <circle key={r} r={r} strokeDasharray={r === 110 ? "2 6" : undefined} />)}
      <g className={still ? undefined : "fx-motion origin-center animate-orbit"}>
        <ellipse rx="200" ry="70" transform="rotate(-24)" />
        <circle cx="182" cy="-80" r="3.5" fill="currentColor" />
      </g>
      <g className={still ? undefined : "fx-motion origin-center animate-orbit-rev"}>
        <ellipse rx="150" ry="46" transform="rotate(32)" />
        <circle cx="-122" cy="-66" r="2.5" fill="currentColor" />
      </g>
      <polygon points="0,-160 139,80 -139,80" strokeOpacity="0.6" />
    </svg>
  );
}

/** Small static constellation (nodes + edges + ring) for empty states and section headers. Uses currentColor. */
export function ConstellationMark({ className }: { className?: string }) {
  const pts: [number, number][] = [[14, 40], [32, 18], [52, 30], [70, 12], [62, 52], [36, 58]];
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5], [5, 0], [1, 5]];
  return (
    <svg viewBox="0 0 84 70" className={cn("overflow-visible", className)} fill="none" aria-hidden>
      <circle cx="42" cy="35" r="33" stroke="currentColor" strokeOpacity="0.15" strokeDasharray="1.5 4" />
      {edges.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]} stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.9" />
      ))}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 2 ? 2.8 : 1.8} fill={i === 2 ? "var(--amber)" : "currentColor"} className={i === 2 ? "fx-motion [animation:twinkle_3s_ease-in-out_infinite]" : undefined} />
      ))}
    </svg>
  );
}

/**
 * Constellation loader: five stars whose connecting lines draw in turn. Replaces generic spinners for
 * page/section loading (inline button spinners stay as they are). With effects off it renders statically.
 */
export function ConstellationLoader({ className, label = "Loading" }: { className?: string; label?: string }) {
  const pts: [number, number][] = [[6, 26], [16, 8], [28, 20], [40, 6], [44, 28]];
  return (
    <span role="status" aria-label={label} className={cn("inline-grid size-12 place-items-center text-ink-3", className)}>
      <svg viewBox="0 0 50 34" className="w-full overflow-visible" fill="none" aria-hidden>
        {pts.slice(1).map(([x, y], i) => (
          <line
            key={i}
            x1={pts[i][0]} y1={pts[i][1]} x2={x} y2={y}
            pathLength={1}
            stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeDasharray="1"
            className="fx-motion"
            style={{ animation: `draw 2.4s ${i * 0.3}s cubic-bezier(.65,0,.35,1) infinite alternate` }}
          />
        ))}
        {pts.map(([x, y], i) => (
          <circle
            key={i} cx={x} cy={y} r={i === 2 ? 2.4 : 1.7}
            fill={i === 2 ? "var(--amber)" : "currentColor"}
            className="fx-motion"
            style={{ animation: `twinkle 1.6s ${i * 0.25}s ease-in-out infinite` }}
          />
        ))}
      </svg>
    </span>
  );
}
