import { cn } from "@/lib/utils";

export type GeoKind = "layers" | "radar" | "mesh" | "orbit" | "shield" | "chain";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 0.9, vectorEffect: "non-scaling-stroke" } as const;
const spin = (s: number, rev = false) => ({ animation: `orbit ${s}s linear infinite${rev ? " reverse" : ""}` });

/** Small hairline geometric illustration per feature chapter. CSS-animated (paused by the effects preference). */
export function Geo({ kind, className }: { kind: GeoKind; className?: string }) {
  return (
    <svg viewBox="-100 -100 200 200" className={cn("overflow-visible text-ink", className)} aria-hidden>
      <g strokeOpacity="0.28">{SHAPES[kind]}</g>
    </svg>
  );
}

const dot = (x: number, y: number, r = 2.6, amber = false, delay = 0) => (
  <circle cx={x} cy={y} r={r} fill={amber ? "var(--amber)" : "currentColor"} fillOpacity={amber ? 1 : 0.6}
    className="fx-motion" style={{ animation: `twinkle 2.6s ${delay}s ease-in-out infinite` }} />
);

const SHAPES: Record<GeoKind, React.ReactNode> = {
  // stacked portfolio layers floating apart
  layers: (
    <>
      {[-34, 0, 34].map((y, i) => (
        <polygon key={y} {...S} points={`0,${y - 26} 70,${y} 0,${y + 26} -70,${y}`} strokeOpacity={0.5 + i * 0.25}
          className="fx-motion" style={{ animation: `float-y 5s ${i * 0.4}s ease-in-out infinite alternate` }} />
      ))}
      <g className="fx-motion origin-center" style={spin(30)}><ellipse {...S} rx="92" ry="30" strokeDasharray="2 6" />{dot(92, 0, 3, true)}</g>
    </>
  ),
  // concentric rings with a sweeping filter beam; matching stars light up
  radar: (
    <>
      {[30, 58, 86].map((r) => <circle key={r} {...S} r={r} />)}
      <line {...S} x1="-90" y1="0" x2="90" y2="0" strokeOpacity="0.4" />
      <line {...S} x1="0" y1="-90" x2="0" y2="90" strokeOpacity="0.4" />
      <g className="fx-motion origin-center" style={spin(6)}>
        <path d="M0 0 L86 0 A86 86 0 0 0 60 -61 Z" fill="var(--amber)" fillOpacity="0.1" stroke="none" />
        <line {...S} x1="0" y1="0" x2="86" y2="0" stroke="var(--amber)" strokeOpacity="0.8" />
      </g>
      {dot(40, -22, 3, true, 0.2)}{dot(-52, 30)}{dot(-20, -64, 2.6, false, 0.6)}{dot(66, 40, 3, true, 1.1)}{dot(-70, -18)}
    </>
  ),
  // a triangulated mesh: one sentence becomes structure
  mesh: (
    <>
      {[[-80, 40, -30, -60, 20, 30], [-30, -60, 60, -50, 20, 30], [20, 30, 60, -50, 85, 50], [-80, 40, 20, 30, -10, 85], [20, 30, 85, 50, -10, 85]].map((p, i) => (
        <polygon key={i} {...S} points={p.join(" ")} pathLength={1} strokeDasharray="1"
          className="fx-motion" style={{ animation: `draw 3.2s ${i * 0.35}s cubic-bezier(.65,0,.35,1) infinite alternate` }} />
      ))}
      {dot(-80, 40)}{dot(-30, -60, 3, true, 0.3)}{dot(60, -50)}{dot(20, 30, 3.4, true, 0.8)}{dot(85, 50)}{dot(-10, 85)}
    </>
  ),
  // ranked creators on orbits around a brief
  orbit: (
    <>
      <circle {...S} r="34" />
      <circle {...S} r="62" strokeDasharray="2 5" />
      <circle {...S} r="90" />
      <g className="fx-motion origin-center" style={spin(24)}>{dot(34, 0, 3.4, true)}</g>
      <g className="fx-motion origin-center" style={spin(36, true)}>{dot(-44, 44, 2.8)}</g>
      <g className="fx-motion origin-center" style={spin(52)}>{dot(0, -90, 2.4)}</g>
      <path {...S} d="M-10 0 H10 M0 -10 V10" stroke="var(--amber)" strokeOpacity="0.9" />
    </>
  ),
  // hexagon seal with a rotating dashed ring and a check
  shield: (
    <>
      <polygon {...S} points="0,-70 61,-35 61,35 0,70 -61,35 -61,-35" strokeOpacity="0.7" />
      <polygon {...S} points="0,-46 40,-23 40,23 0,46 -40,23 -40,-23" />
      <g className="fx-motion origin-center" style={spin(28)}><circle {...S} r="88" strokeDasharray="1 7" strokeOpacity="0.9" /></g>
      <path d="M-16 2 L-4 14 L18 -12" fill="none" stroke="var(--amber)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
        pathLength={1} strokeDasharray="1" className="fx-motion" style={{ animation: "draw 1.6s .2s cubic-bezier(.65,0,.35,1) infinite alternate" }} />
    </>
  ),
  // hire → fund → deliver → release, a pulse travelling the chain
  chain: (
    <>
      <path {...S} d="M-85 40 C -50 -40, -20 60, 10 -10 S 60 -60, 85 -30" />
      {dot(-85, 40)}{dot(-38, 14)}{dot(10, -10, 3, true)}{dot(52, -46)}{dot(85, -30, 3.4, true, 0.5)}
      <circle r="4" fill="var(--amber)" className="fx-motion" style={{ offsetPath: "path('M-85 40 C -50 -40, -20 60, 10 -10 S 60 -60, 85 -30')", animation: "travel 4s ease-in-out infinite" }} />
      <rect {...S} x="-30" y="48" width="60" height="34" rx="8" strokeOpacity="0.6" />
      <path {...S} d="M-14 48 v-10 a14 14 0 0 1 28 0 v10" strokeOpacity="0.6" />
    </>
  ),
};
