/** The project orb: glow, pulses, orbit rings, Fibonacci shell and inner network (ported from the reference). */
import { C, TAU, persp, rotX, rotate, sg, type V3 } from "./math";
import type { Geometry } from "./geometry";
import { SCENES, type Frame } from "./timeline";

/** 0 = low (mobile / struggling), 1 = medium, 2 = full detail */
export type Quality = 0 | 1 | 2;

/** Per-frame scratch space, allocated once (no garbage in the render loop). */
export interface Buffers {
  sx: Float32Array; ix: Float32Array; P: Float32Array; LC: Float32Array; J: Float32Array;
  q: V3; buckets: number[][];
}
export const makeBuffers = (g: Geometry): Buffers => ({
  sx: new Float32Array(g.shell.length * 3),
  ix: new Float32Array(g.inner.length * 3),
  P: new Float32Array(g.verts.length * 3),
  LC: new Float32Array(g.verts.length),
  J: new Float32Array(g.mind.length * 3),
  q: [0, 0, 0],
  buckets: [[], [], [], []],
});

/** Project shell and inner network to screen space (the figure morphs out of these points). */
export function projectOrb(g: Geometry, f: Frame, b: Buffers) {
  const { q } = b;
  const s = f.R * (1 + f.o * 0.75);
  g.shell.forEach((v, i) => {
    rotate(v, f.ay, f.ax, q);
    const ff = persp(q[2]);
    b.sx[i * 3] = f.ox + q[0] * s * ff; b.sx[i * 3 + 1] = f.oy + q[1] * s * ff; b.sx[i * 3 + 2] = q[2];
  });
  const is = f.R * (0.45 + 0.55 * f.o) * 1.35;
  g.inner.forEach((v, i) => {
    rotate(v, f.ay, f.ax, q);
    const ff = persp(q[2]);
    b.ix[i * 3] = f.ox + q[0] * is * ff; b.ix[i * 3 + 1] = f.oy + q[1] * is * ff; b.ix[i * 3 + 2] = q[2];
  });
}

/** Soft glowing dot: real shadow blur at full quality, a cheap halo otherwise. */
export function glowDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, blur: number, quality: Quality, alpha = 1) {
  if (quality === 2) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = `rgb(${C.star})`;
    ctx.shadowBlur = blur;
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgba(${C.star},0.18)`;
  ctx.beginPath(); ctx.arc(x, y, r + blur * 0.35, 0, TAU); ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}

/** Orbit rings: back halves before the orb, front halves after the figure. */
export function drawRings(ctx: CanvasRenderingContext2D, g: Geometry, f: Frame, front: boolean, quality: Quality) {
  if (f.ob <= 0.01) return;
  const { t, o, ob, R, ox, oy } = f;
  const rk = (1 + o * 0.5) * (1 - 0.35 * f.k);
  const segs = quality ? 64 : 40;
  const q: V3 = [0, 0, 0];
  g.rings.forEach((rg, gi) => {
    ctx.strokeStyle = `rgba(${C.star},${(front ? 0.5 : 0.2) * (1 - o * 0.45) * ob})`;
    ctx.lineWidth = front ? 1.3 : 1;
    ctx.beginPath();
    let on = false;
    for (let s = 0; s <= segs; s++) {
      const th = (s / segs) * TAU;
      rotate(rotX([Math.cos(th) * rg.r, 0, Math.sin(th) * rg.r], rg.ax), t * rg.sp * 0.5, 0.3, q);
      if ((q[2] >= 0) === front) {
        const ff = persp(q[2]), X = ox + q[0] * R * rk * ff, Y = oy + q[1] * R * rk * ff;
        if (on) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        on = true;
      } else on = false;
    }
    ctx.stroke();
    const td = t * rg.v + gi * 2;
    rotate(rotX([Math.cos(td) * rg.r, 0, Math.sin(td) * rg.r], rg.ax), t * rg.sp * 0.5, 0.3, q);
    if ((q[2] >= 0) === front) {
      const ff = persp(q[2]);
      glowDot(ctx, ox + q[0] * R * rk * ff, oy + q[1] * R * rk * ff, 2.4 * ff, "#ffe2a3", 12, quality, ob);
    }
  });
}

/** Glow, pulses, chapter flashes, back rings, shell and inner network. */
export function drawOrb(ctx: CanvasRenderingContext2D, g: Geometry, f: Frame, b: Buffers, quality: Quality) {
  const { t, o, ob, R, ox, oy, k, sp } = f;
  if (ob <= 0.01) return;
  const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, R * (1.3 + o));
  grad.addColorStop(0, `rgba(${C.star},${0.34 * (1 - o * 0.5) * ob})`);
  grad.addColorStop(1, `rgba(${C.star},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(ox - R * 3, oy - R * 3, R * 6, R * 6);

  // pulses
  for (let i = 0; i < 2; i++) {
    const ph = (t / 2.6 + i * 0.5) % 1;
    ctx.strokeStyle = `rgba(${C.star},${(1 - ph) * 0.28 * ob})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(ox, oy, R * (1.05 + ph * 1.5 * (1 - k * 0.5)), 0, TAU); ctx.stroke();
  }
  // a ring flashes outward as each later chapter lands
  for (const c of SCENES.flashes) {
    const p = sg(sp, c, c + 0.04);
    if (p > 0 && p < 1) {
      ctx.strokeStyle = `rgba(${C.star},${(1 - p) * 0.55})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ox, oy, R * (1.1 + p * 2.4), 0, TAU); ctx.stroke();
    }
  }
  drawRings(ctx, g, f, false, quality);

  // shell edges (fewer at low quality)
  const sx = b.sx, E = g.shellEdges, stride = quality === 0 ? 6 : quality === 1 ? 4 : 2;
  ctx.strokeStyle = `rgba(${C.star},${0.11 * (1 - o * 0.85) * ob})`;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let e = 0; e < E.length; e += stride) {
    const i = E[e] * 3, j = E[e + 1] * 3;
    if (sx[i + 2] > -0.25 && sx[j + 2] > -0.25) { ctx.moveTo(sx[i], sx[i + 1]); ctx.lineTo(sx[j], sx[j + 1]); }
  }
  ctx.stroke();

  // shell dots
  const n = g.shell.length, step = quality === 0 ? 2 : 1;
  for (let i = 0; i < n; i += step) {
    const x = sx[i * 3], y = sx[i * 3 + 1], z = sx[i * 3 + 2];
    const pu = Math.max(0, Math.sin(t * 2.2 - i * 0.37)) * 0.25;
    ctx.fillStyle = `rgba(${C.star},${(0.25 + (0.55 * (z + 1)) / 2 + pu * (1 - o)) * (1 - o * 0.65) * ob})`;
    ctx.beginPath(); ctx.arc(x, y, (1 + (z + 1) * 0.45) * (1 + pu * 0.8), 0, TAU); ctx.fill();
  }

  // inner network
  if (o > 0.01) {
    const ix = b.ix, IE = g.innerEdges;
    ctx.strokeStyle = `rgba(${C.star},${0.3 * o * ob})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let e = 0; e < IE.length; e += 2) {
      const i = IE[e] * 3, j = IE[e + 1] * 3;
      ctx.moveTo(ix[i], ix[i + 1]); ctx.lineTo(ix[j], ix[j + 1]);
    }
    ctx.stroke();
    for (let i = 0; i < g.inner.length; i++) {
      const pu = Math.max(0, Math.sin(t * 2 - g.innerPhase[i] * 2));
      ctx.fillStyle = i ? `rgba(${C.light},${(0.5 + 0.4 * pu) * o * ob})` : `rgba(${C.bright},${o * ob})`;
      ctx.beginPath(); ctx.arc(ix[i * 3], ix[i * 3 + 1], i ? 1.4 + pu * 1.6 : 3.4 + pu * 2, 0, TAU); ctx.fill();
    }
  }
}
