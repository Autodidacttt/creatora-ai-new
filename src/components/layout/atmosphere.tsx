/** Soft blurred backdrop with drifting light blobs and faint line-art — the "photo behind the glass". */
export function Atmosphere() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg-2 to-bg" />
      <div className="absolute -left-[10%] -top-[15%] h-[55vmax] w-[55vmax] rounded-full bg-[var(--blob-1)] opacity-50 blur-[110px] animate-drift" />
      <div className="absolute -right-[15%] top-[20%] h-[50vmax] w-[50vmax] rounded-full bg-[var(--blob-2)] opacity-60 blur-[120px] animate-drift-slow" />
      <div className="absolute bottom-[-25%] left-[25%] h-[45vmax] w-[45vmax] rounded-full bg-[var(--blob-3)] opacity-70 blur-[100px] animate-drift" />
      <LineArt className="absolute right-[-6rem] top-[-4rem] h-[38rem] w-[38rem] text-amber-2 opacity-[0.16] dark:opacity-[0.12]" />
      <LineArt className="absolute bottom-[-10rem] left-[-8rem] h-[30rem] w-[30rem] rotate-180 text-ink opacity-[0.05]" />
    </div>
  );
}

/** Fine radial "web" line-art. */
export function LineArt({ className }: { className?: string }) {
  const rings = [40, 80, 120, 160, 200];
  const spokes = Array.from({ length: 16 }, (_, i) => (i * Math.PI * 2) / 16);
  return (
    <svg viewBox="-220 -220 440 440" className={className} fill="none" stroke="currentColor" strokeWidth="0.8">
      {rings.map((r) => (
        <polygon
          key={r}
          points={spokes.map((a) => `${Math.cos(a) * r},${Math.sin(a) * r}`).join(" ")}
        />
      ))}
      {spokes.map((a, i) => (
        <line key={i} x1="0" y1="0" x2={Math.cos(a) * 210} y2={Math.sin(a) * 210} />
      ))}
      <path d="M-210 60 C -80 -40, 80 160, 210 40" />
      <path d="M-210 100 C -60 0, 100 200, 210 90" />
    </svg>
  );
}
