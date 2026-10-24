/** Small numeric helpers shared by the scroll story (ported 1:1 from the reference script). */
export type V3 = [number, number, number];

export const TAU = Math.PI * 2;
/** clamp */
export const cl = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** smoothstep */
export const sm = (x: number) => x * x * (3 - 2 * x);
/** 0→1 progress of p across [a, b] */
export const sg = (p: number, a: number, b: number) => cl((p - a) / (b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** fade in across [a, b], out across [c, d] */
export const win = (p: number, a: number, b: number, c: number, d: number) => sg(p, a, b) * (1 - sg(p, c, d));
/** cheap perspective factor for a unit-sphere depth z */
export const persp = (z: number) => 1 / (1 - z * 0.18);
export const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Rotate around Y (ay) then X (ax), writing into `out` (no allocation). */
export function rotate(v: V3, ay: number, ax: number, out: V3): V3 {
  const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
  const x = v[0] * cy + v[2] * sy, z = -v[0] * sy + v[2] * cy, y = v[1];
  out[0] = x;
  out[1] = y * cx - z * sx;
  out[2] = y * sx + z * cx;
  return out;
}
export const rotX = (v: V3, a: number): V3 => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];

/** Deterministic PRNG so the precomputed geometry is identical on every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Amber star + highlight tones (mirror --glow-rgb and --bg in globals.css). */
export const C = {
  star: "253,184,40",
  light: "255,226,163",
  bright: "255,240,200",
  ink: "18,16,13",
} as const;
