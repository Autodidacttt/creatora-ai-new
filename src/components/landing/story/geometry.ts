/**
 * Precomputed scene geometry (built once, lazily): the orb's Fibonacci shell + inner network + orbit rings, and the
 * low-poly creator bust with its pen-drawn portrait lines, hatched planes and "mind network". Ported 1:1 from the
 * reference script; random values come from a seeded PRNG so the bust is identical on every load.
 */
import { TAU, cl, dist, lerp, rng, sg, type V3 } from "./math";

export interface Ring { r: number; ax: number; sp: number; v: number }
export interface Plane { v: V3[]; a: number; g: number; o: number; w: number; f: number; d: number }

export interface Geometry {
  shell: V3[];
  /** flat [i, j, i, j, …] */
  shellEdges: Uint16Array;
  inner: V3[];
  innerEdges: Uint16Array;
  innerPhase: Float32Array;
  rings: Ring[];
  /** bust mesh vertices, then portrait line vertices from `featureStart` */
  verts: V3[];
  meshEdges: Uint16Array;
  featureEdges: Uint16Array;
  featureWeight: Float32Array;
  featureStart: number;
  planes: Plane[];
  eyes: V3[];
  /** per-vertex: assembly delay, sideways swirl, chest fade-out, see-through weight */
  delay: Float32Array;
  swirl: Float32Array;
  fade: Float32Array;
  weight: Float32Array;
  mind: V3[];
  mindEdges: [number, number][];
}

let cached: Geometry | null = null;
export const getGeometry = () => (cached ??= build());

function build(): Geometry {
  const rnd = rng(20261024);

  // Orb shell: Fibonacci sphere, edges between near neighbours
  const N = 240;
  const shell: V3[] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), th = i * 2.39996;
    shell.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  const se: number[] = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (dist(shell[i], shell[j]) < 0.36) se.push(i, j);

  // Inner network: a core node plus random points in a ball
  const M = 64;
  const inner: V3[] = [[0, 0, 0]];
  while (inner.length < M) {
    const v: V3 = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    if (Math.hypot(...v) <= 1) inner.push([v[0] * 0.62, v[1] * 0.62, v[2] * 0.62]);
  }
  const ie: number[] = [];
  for (let i = 0; i < M; i++) for (let j = i + 1; j < M; j++) if (dist(inner[i], inner[j]) < (i ? 0.46 : 0.6)) ie.push(i, j);
  const innerPhase = Float32Array.from(inner, () => rnd() * TAU);
  const rings: Ring[] = [{ r: 1.5, ax: 1.2, sp: 0.35, v: 0.9 }, { r: 1.78, ax: 0.35, sp: -0.28, v: -0.7 }, { r: 2.08, ax: -0.7, sp: 0.2, v: 0.55 }];

  // Low-poly bust: stacked rings [x, y, z, rx, rzFront, rzBack, squareness] per part, triangulated, then stitched
  const HV: V3[] = [], HE: number[] = [], FE: number[] = [];
  const part = (st: number[][], n: number) => {
    const b = HV.length;
    st.forEach(([x, y, z, rx, rf, rb, e], si) => {
      for (let j = 0; j < n; j++) {
        const a = ((j + si * 0.5) / n) * TAU, c = Math.cos(a), s = Math.sin(a), i = b + si * n + j;
        HV.push([x + Math.sign(c) * Math.abs(c) ** e * rx, y, z + Math.sign(s) * Math.abs(s) ** e * (s > 0 ? rf : rb)]);
        HE.push(i, b + si * n + ((j + 1) % n));
        if (si) HE.push(i, i - n, i, b + (si - 1) * n + ((j + 1) % n));
      }
    });
    return { f: b, l: b + (st.length - 1) * n };
  };
  const near = (A: number, na: number, B: number, nb: number) => {
    for (let i = 0; i < na; i++) {
      let bj = 0, bd = 9;
      for (let j = 0; j < nb; j++) { const d = dist(HV[A + i], HV[B + j]); if (d < bd) { bd = d; bj = j; } }
      HE.push(A + i, B + bj);
    }
  };
  const link = (A: number, na: number, B: number, nb: number) => { near(A, na, B, nb); near(B, nb, A, na); };

  // Head profile [y, rx, rzFront, rzBack]: deeper at the back of the skull, forward at the face and chin
  const HP = [[-0.965, 0.14, 0.12, 0.15], [-0.9, 0.24, 0.22, 0.27], [-0.8, 0.31, 0.29, 0.33], [-0.68, 0.34, 0.32, 0.35], [-0.56, 0.34, 0.34, 0.33], [-0.44, 0.32, 0.35, 0.29], [-0.33, 0.28, 0.33, 0.24], [-0.23, 0.23, 0.29, 0.18], [-0.14, 0.16, 0.24, 0.12], [-0.085, 0.08, 0.17, 0.06]];
  const head = part(HP.map(([y, rx, rf, rb]) => [0, y, 0, rx, rf, rb, 1]), 14);
  HV.push([0, -1, 0]);
  for (let j = 0; j < 14; j++) HE.push(HV.length - 1, head.f + j);
  const neck = part([[0, -0.06, -0.06, 0.12, 0.12, 0.12, 1], [0, 0.05, -0.04, 0.125, 0.125, 0.125, 1], [0, 0.15, -0.03, 0.14, 0.13, 0.13, 1]], 12);
  const chest = part([[0, 0.2, -0.03, 0.17, 0.13, 0.13, 1], [0, 0.26, -0.02, 0.36, 0.17, 0.17, 0.85], [0, 0.31, -0.01, 0.52, 0.2, 0.2, 0.7], [0, 0.37, 0, 0.62, 0.22, 0.22, 0.6], [0, 0.44, 0, 0.68, 0.23, 0.23, 0.6], [0, 0.53, 0, 0.7, 0.24, 0.24, 0.6], [0, 0.63, 0, 0.69, 0.24, 0.24, 0.6]], 16);
  link(head.l, 14, neck.f, 12);
  link(neck.l, 12, chest.f, 16);
  const headCount = HV.length;

  // Surface profile rows [y, rx, rzFront, zOffset, squareness] used to lay the portrait onto the mesh
  const PF = [...HP.map(([y, rx, rf]) => [y, rx, rf, 0, 1]), [-0.06, 0.12, 0.12, -0.06, 1], [0.05, 0.125, 0.125, -0.04, 1], [0.15, 0.14, 0.13, -0.03, 1], [0.2, 0.17, 0.13, -0.03, 1], [0.26, 0.36, 0.17, -0.02, 0.85], [0.31, 0.52, 0.2, -0.01, 0.7], [0.37, 0.62, 0.22, 0, 0.6], [0.44, 0.68, 0.23, 0, 0.6], [0.53, 0.7, 0.24, 0, 0.6], [0.63, 0.69, 0.24, 0, 0.6]];
  const surf = (x: number, y: number, d = 0): V3 => {
    let k = 0;
    while (k < PF.length - 2 && PF[k + 1][0] < y) k++;
    const a = PF[k], b = PF[k + 1], u = cl((y - a[0]) / (b[0] - a[0]));
    const [rx, rf, zo, e] = [1, 2, 3, 4].map((j) => lerp(a[j], b[j], u));
    return [x, y, zo + rf * Math.max(0, 1 - Math.min(1, Math.abs(x) / rx) ** (2 / e)) ** (e / 2) + 0.012 + d];
  };
  const hair = (x: number, y: number, l = 0): V3 => {
    const p = surf(x, y), v: V3 = [p[0], p[1] + 0.55, p[2]], n = Math.hypot(...v);
    return [p[0] + (v[0] / n) * l, p[1] + (v[1] / n) * l, p[2] + (v[2] / n) * l];
  };
  const raw = (x: number, y: number, z = 0): V3 => [x, y, z];
  type Map3 = (x: number, y: number, d?: number) => V3;
  type P3 = [number, number, number];
  const mir = (l: P3[]): P3[] => l.map(([x, y, d]) => [-x, y, d]);
  const both = (l: P3[]): P3[][] => [l, mir(l)];

  // Portrait after the pen reference: strong feature lines (w=1), faint facet lines, hatched planes
  const LN: [V3[], number][] = [];
  const ln = (w: number, map: Map3, ...ls: P3[][]) => ls.forEach((l) => LN.push([l.map((p) => map(...p)), w]));
  const iris: P3[] = Array.from({ length: 9 }, (_, j) => { const a = (j / 8) * TAU; return [-0.14 + Math.cos(a) * 0.021, -0.574 + Math.sin(a) * 0.02, 0.008]; });
  ln(1, surf,
    ...both([[-0.215, -0.566, 0], [-0.19, -0.585, 0.004], [-0.15, -0.597, 0.006], [-0.11, -0.59, 0.006], [-0.075, -0.572, 0.003], [-0.063, -0.566, 0]]),
    ...both([[-0.205, -0.585, 0.002], [-0.17, -0.608, 0.006], [-0.12, -0.61, 0.006], [-0.085, -0.594, 0.003]]),
    ...both([[-0.205, -0.566, 0], [-0.16, -0.552, 0.004], [-0.11, -0.553, 0.004], [-0.072, -0.564, 0]]), ...both(iris),
    [[-0.03, -0.62, 0.02], [-0.028, -0.52, 0.05], [-0.042, -0.445, 0.075]],
    [[-0.042, -0.445, 0.075], [-0.022, -0.418, 0.095], [0, -0.41, 0.1], [0.022, -0.418, 0.095], [0.042, -0.445, 0.075]],
    ...both([[-0.042, -0.445, 0.075], [-0.062, -0.42, 0.045], [-0.06, -0.397, 0.04], [-0.04, -0.387, 0.05], [-0.015, -0.39, 0.07], [0, -0.394, 0.08]]),
    [[-0.115, -0.285, 0], [-0.06, -0.303, 0.012], [-0.02, -0.31, 0.02], [0, -0.303, 0.022], [0.02, -0.31, 0.02], [0.06, -0.303, 0.012], [0.115, -0.285, 0]],
    [[-0.115, -0.285, 0], [-0.06, -0.288, 0.012], [0, -0.283, 0.02], [0.06, -0.288, 0.012], [0.115, -0.285, 0]],
    [[-0.11, -0.283, 0], [-0.07, -0.262, 0.012], [0, -0.25, 0.02], [0.07, -0.262, 0.012], [0.11, -0.283, 0]],
    ...both([[-0.012, -0.375, 0.06], [-0.017, -0.315, 0.02]]),
    [[-0.31, -0.44, 0], [-0.26, -0.29, 0], [-0.17, -0.17, 0], [-0.07, -0.115, 0.01], [0, -0.11, 0.01], [0.07, -0.115, 0.01], [0.17, -0.17, 0], [0.26, -0.29, 0], [0.31, -0.44, 0]],
    ...both([[-0.13, 0.08, 0], [-0.16, 0.22, 0], [-0.26, 0.3, 0], [-0.08, 0.34, 0.01], [0, 0.22, 0.015]]),
    [[-0.03, 0.22, 0.02], [0.03, 0.22, 0.02], [0.028, 0.29, 0.02], [-0.028, 0.29, 0.02], [-0.03, 0.22, 0.02]],
    [[-0.028, 0.29, 0.02], [-0.045, 0.44, 0.02], [0, 0.5, 0.02], [0.045, 0.44, 0.02], [0.028, 0.29, 0.02]],
    [[0.36, 0.27, 0], [0.58, 0.36, 0], [0.6, 0.4, 0], [0.38, 0.31, 0], [0.36, 0.27, 0]]);
  ln(1, raw, ...[-1, 1].flatMap((s): P3[][] => [
    [[s * 0.33, -0.6, 0.02], [s * 0.39, -0.56, -0.02], [s * 0.385, -0.46, -0.04], [s * 0.34, -0.4, -0.02]],
    [[s * 0.35, -0.57, 0], [s * 0.37, -0.52, -0.02], [s * 0.355, -0.46, -0.02]],
  ]));
  ln(0.55, surf, [[0.03, -0.6, 0.02], [0.03, -0.52, 0.05], [0.042, -0.445, 0.075]],
    ...both([[-0.31, -0.52, 0], [-0.22, -0.47, 0.01], [-0.12, -0.45, 0.015]]), ...both([[-0.062, -0.41, 0.03], [-0.11, -0.33, 0.01], [-0.125, -0.28, 0]]),
    ...both([[-0.22, -0.47, 0.01], [-0.2, -0.36, 0.005], [-0.125, -0.28, 0]]), ...both([[-0.25, -0.56, 0], [-0.3, -0.43, 0]]),
    ...both([[-0.12, -0.285, 0], [-0.09, -0.19, 0], [-0.04, -0.12, 0.01]]), [[-0.06, -0.17, 0.01], [0, -0.175, 0.015], [0.06, -0.17, 0.01]],
    ...both([[-0.06, -0.668, 0.02], [-0.11, -0.74, 0.01], [-0.22, -0.71, 0.005]]), ...both([[-0.245, -0.64, 0.01], [-0.31, -0.6, 0]]),
    ...both([[-0.21, -0.56, 0], [-0.16, -0.52, 0.01], [-0.08, -0.53, 0.01]]), ...both([[-0.1, -0.04, 0], [-0.08, 0.12, 0]]), [[-0.04, 0.02, 0], [0, 0.06, 0], [0.04, 0.02, 0]],
    ...both([[-0.26, 0.3, 0], [-0.2, 0.4, 0], [-0.14, 0.5, 0]]), [[-0.36, 0.27, 0], [-0.5, 0.36, 0], [-0.62, 0.45, 0]]);
  ln(0.45, hair, [[-0.33, -0.7, 0.03], [-0.26, -0.86, 0.05], [-0.12, -0.96, 0.062], [0.04, -0.97, 0.062], [0.2, -0.92, 0.055]],
    [[-0.24, -0.76, 0.035], [-0.12, -0.86, 0.055], [0.02, -0.88, 0.06], [0.16, -0.86, 0.05], [0.28, -0.8, 0.035]],
    [[-0.15, -0.79, 0.033], [-0.05, -0.84, 0.05], [0.08, -0.84, 0.05], [0.22, -0.79, 0.035]]);
  const featureStart = HV.length;
  const FW: number[] = [];
  LN.forEach(([l, w]) => {
    const b = HV.length;
    l.forEach((p, j) => { HV.push(p); if (j) { FE.push(b + j - 1, b + j); FW.push(w); } });
  });

  // Hatched planes {v, hatch angle, gap, hatch alpha, outline alpha, dark fill}
  const planes: Plane[] = [];
  const pg = (map: Map3, pts: P3[], deg: number, g: number, o: number, w = 0, f = 0) => {
    const v = pts.map((p) => map(...p));
    planes.push({ v, a: (deg * Math.PI) / 180, g, o, w, f, d: 1 - sg(v.reduce((s, p) => s + p[1], 0) / v.length, 0.34, 0.62) });
  };
  // hair facets [hatch angle, ...points]: crown planes plus a fringe swept to the right
  ([
    [70, [-0.355, -0.66, 0.02], [-0.35, -0.78, 0.03], [-0.29, -0.9, 0.05], [-0.2, -0.8, 0.04], [-0.27, -0.72, 0.025], [-0.31, -0.66, 0.015]],
    [35, [-0.29, -0.9, 0.05], [-0.17, -0.99, 0.06], [-0.05, -0.9, 0.06], [-0.2, -0.8, 0.04]],
    [12, [-0.17, -0.99, 0.06], [-0.02, -1.03, 0.06], [0.14, -1, 0.06], [0.05, -0.9, 0.06], [-0.05, -0.9, 0.06]],
    [-25, [0.14, -1, 0.06], [0.27, -0.92, 0.05], [0.2, -0.82, 0.04], [0.05, -0.9, 0.06]],
    [-65, [0.27, -0.92, 0.05], [0.35, -0.8, 0.03], [0.355, -0.66, 0.02], [0.31, -0.66, 0.015], [0.3, -0.74, 0.025], [0.2, -0.82, 0.04]],
    [22, [-0.2, -0.8, 0.04], [-0.05, -0.9, 0.06], [-0.02, -0.8, 0.045], [-0.12, -0.775, 0.03], [-0.27, -0.72, 0.025]],
    [-8, [-0.05, -0.9, 0.06], [0.05, -0.9, 0.06], [0.2, -0.82, 0.04], [0.12, -0.79, 0.035], [-0.02, -0.8, 0.045]],
    [-40, [0.2, -0.82, 0.04], [0.3, -0.74, 0.025], [0.24, -0.76, 0.03], [0.12, -0.79, 0.035]],
  ] as [number, ...P3[]][]).forEach(([a, ...p]) => pg(hair, p, a, 0.75, 0.38, 0.55, 0.6));
  // strand tips breaking up the hairline
  ([
    [[-0.27, -0.72, 0.025], [-0.2, -0.76, 0.035], [-0.25, -0.68, 0.015]], [[-0.12, -0.775, 0.03], [-0.06, -0.79, 0.04], [-0.1, -0.735, 0.02]],
    [[-0.02, -0.8, 0.045], [0.05, -0.795, 0.04], [0, -0.75, 0.025]], [[0.12, -0.79, 0.035], [0.18, -0.78, 0.035], [0.15, -0.74, 0.02]],
  ] as P3[][]).forEach((p) => pg(hair, p, 30, 0.75, 0.38, 0.55, 0.6));
  const brow: P3[] = [[-0.25, -0.645, 0.02], [-0.2, -0.676, 0.025], [-0.12, -0.688, 0.027], [-0.055, -0.668, 0.027], [-0.058, -0.65, 0.027], [-0.12, -0.662, 0.027], [-0.2, -0.655, 0.025], [-0.245, -0.636, 0.02]];
  pg(surf, brow, 30, 0.55, 0.6, 0.8);
  pg(surf, mir(brow), -30, 0.55, 0.6, 0.8);
  pg(surf, [[-0.115, -0.285, 0], [-0.06, -0.303, 0.012], [-0.02, -0.31, 0.02], [0, -0.303, 0.022], [0.02, -0.31, 0.02], [0.06, -0.303, 0.012], [0.115, -0.285, 0], [0.06, -0.288, 0.012], [0, -0.283, 0.02], [-0.06, -0.288, 0.012]], -15, 0.8, 0.4);
  both([[-0.05, -0.398, 0.045], [-0.032, -0.393, 0.055], [-0.02, -0.389, 0.065], [-0.04, -0.386, 0.05]]).forEach((p, i) => pg(surf, p, i ? -40 : 40, 0.5, 0.6));
  both([[-0.22, -0.585, 0], [-0.17, -0.612, 0.006], [-0.1, -0.61, 0.006], [-0.065, -0.585, 0], [-0.11, -0.596, 0.006], [-0.17, -0.598, 0.006]]).forEach((p, i) => pg(surf, p, i ? -20 : 20, 1.1, 0.25));
  pg(surf, [[-0.03, -0.62, 0.02], [-0.028, -0.52, 0.05], [-0.042, -0.445, 0.075], [-0.062, -0.42, 0.045], [-0.055, -0.5, 0.02], [-0.055, -0.6, 0.01]], 75, 1.1, 0.22);
  pg(surf, [[-0.07, -0.25, 0.01], [0, -0.243, 0.015], [0.07, -0.25, 0.01], [0.035, -0.21, 0.01], [-0.035, -0.21, 0.01]], 10, 1.1, 0.24);
  pg(surf, [[-0.31, -0.5, 0], [-0.22, -0.47, 0.01], [-0.2, -0.36, 0.005], [-0.27, -0.3, 0]], 60, 1.3, 0.18);
  pg(surf, [[0.31, -0.5, 0], [0.22, -0.47, 0.01], [0.2, -0.36, 0.005], [0.27, -0.3, 0]], -60, 1.5, 0.1);
  pg(surf, [[-0.31, -0.6, 0], [-0.245, -0.64, 0.01], [-0.25, -0.56, 0], [-0.3, -0.43, 0], [-0.33, -0.5, 0]], 80, 1.3, 0.16);
  pg(surf, [[-0.12, -0.06, 0], [0.12, -0.06, 0], [0.1, 0.04, 0], [-0.1, 0.04, 0]], -10, 1.1, 0.22);
  pg(surf, [[-0.03, 0.22, 0.02], [0.03, 0.22, 0.02], [0.028, 0.29, 0.02], [-0.028, 0.29, 0.02]], 45, 0.6, 0.4);
  const eyes = [surf(-0.14, -0.574, 0.01), surf(0.14, -0.574, 0.01)];

  // Each vertex leaves the orb shell with a top-down stagger (facial features last) and a sideways swirl;
  // the chest fades out; vertices on the far side of the face are see-through
  const n = HV.length;
  const delay = new Float32Array(n), swirl = new Float32Array(n), fade = new Float32Array(n), weight = new Float32Array(n);
  HV.forEach((v, i) => {
    delay[i] = i < featureStart ? ((v[1] + 1) / 1.65) * 0.5 + rnd() * 0.1 : 0.5 + rnd() * 0.08;
    swirl[i] = rnd() * 2 - 1;
    fade[i] = 1 - sg(v[1], 0.34, 0.62);
    weight[i] = i < headCount && v[2] > 0.1 && v[1] > -0.8 ? 0.22 : 1;
  });

  // Mind network: the inner network becomes nodes inside the head, down the spine to the heart
  const mind: V3[] = [[0, -0.72, 0], [-0.16, -0.74, 0.02], [0.16, -0.74, 0.02], [-0.1, -0.86, -0.08], [0.1, -0.86, -0.08], [0, -0.58, -0.12], [-0.17, -0.6, -0.14], [0.17, -0.6, -0.14], [0, -0.9, 0.02], [0, -0.25, -0.12], [0, 0.1, -0.06], [0, 0.42, 0.06], [-0.5, 0.4, 0], [0.5, 0.4, 0]];
  const mindEdges: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 8], [1, 3], [2, 4], [3, 8], [4, 8], [1, 6], [2, 7], [5, 6], [5, 7], [5, 9], [9, 10], [10, 11], [10, 12], [10, 13], [11, 12], [11, 13]];

  return {
    shell, shellEdges: Uint16Array.from(se), inner, innerEdges: Uint16Array.from(ie), innerPhase, rings,
    verts: HV, meshEdges: Uint16Array.from(HE), featureEdges: Uint16Array.from(FE), featureWeight: Float32Array.from(FW), featureStart,
    planes, eyes, delay, swirl, fade, weight, mind, mindEdges,
  };
}
