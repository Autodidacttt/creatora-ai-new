/**
 * The creator bust, assembled from the orb's shell (mesh) and inner network (mind skeleton): mesh, mind network,
 * hatched planes, portrait lines, eyes, scan line and the skills ring. Ported from the reference.
 */
import { C, TAU, cl, lerp, persp, rotate, sg, sm, type V3 } from "./math";
import type { Geometry } from "./geometry";
import type { Frame, Layout } from "./timeline";
import { glowDot, type Buffers, type Quality } from "./draw-orb";

export function drawFigure(ctx: CanvasRenderingContext2D, g: Geometry, f: Frame, L: Layout, b: Buffers, quality: Quality) {
  const { m, t, ps, fm, hv, hb, mx, my } = f;
  if (m <= 0.001) return;
  const { S, HX, HY, RA, RB } = L;
  const yaw = (ps - 0.58) * 2.2 + Math.sin(t * 0.3) * 0.18 + mx * 0.6, tl = 0.06 + my * 0.1;
  const hy = HY + hb, ry = L.RY + hb, crown = hy - 1.08 * S;
  const q: V3 = [0, 0, 0];
  const P3 = (v: V3, out: Float32Array | number[], o: number) => {
    rotate(v, yaw, tl, q);
    const ff = persp(q[2]);
    out[o] = HX + q[0] * S * ff; out[o + 1] = hy + q[1] * S * ff; out[o + 2] = q[2];
  };

  // aura and ground ring once the figure has formed
  if (fm > 0.01) {
    const ag = ctx.createRadialGradient(HX, hy - 0.35 * S, 0, HX, hy - 0.35 * S, S * 1.3);
    ag.addColorStop(0, `rgba(${C.star},${0.13 * fm})`);
    ag.addColorStop(1, `rgba(${C.star},0)`);
    ctx.fillStyle = ag;
    ctx.fillRect(HX - S * 1.4, hy - S * 1.7, S * 2.8, S * 2.7);
    const gy = HY + 0.66 * S, gr = 0.55 * S;
    ctx.strokeStyle = `rgba(${C.star},${0.3 * fm})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(HX, gy, gr, gr * 0.16, 0, 0, TAU); ctx.stroke();
    for (let i = 0; i < 2; i++) {
      const ph = (t / 2.4 + i * 0.5) % 1, r = gr * (1 + ph * 0.5);
      ctx.strokeStyle = `rgba(${C.star},${(1 - ph) * 0.2 * fm})`;
      ctx.beginPath(); ctx.ellipse(HX, gy, r, r * 0.16, 0, 0, TAU); ctx.stroke();
    }
  }

  // skills ring: projection cone from the crown, then the back half
  if (hv > 0.01) {
    const cg = ctx.createLinearGradient(0, crown, 0, ry);
    cg.addColorStop(0, `rgba(${C.star},${0.16 * hv})`);
    cg.addColorStop(1, `rgba(${C.star},${0.03 * hv})`);
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.moveTo(HX, crown); ctx.lineTo(HX - RA, ry); ctx.ellipse(HX, ry, RA, RB, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = `rgba(${C.star},${0.3 * hv})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(HX, ry, RA, RB, 0, Math.PI, Math.PI * (1 + hv)); ctx.stroke();
  }

  // mesh: every vertex flies from its orb-shell point to its place on the bust
  const { P, LC, sx } = b;
  const N = g.shell.length, T = [0, 0, 0];
  g.verts.forEach((v, i) => {
    P3(v, T, 0);
    const l = (LC[i] = sm(cl((m - g.delay[i]) / 0.4)));
    const o = i * 3;
    if (l >= 1) { P[o] = T[0]; P[o + 1] = T[1]; P[o + 2] = T[2]; return; }
    const s = (i % N) * 3, w = Math.sin(Math.PI * l) * g.swirl[i] * S * 0.4;
    P[o] = lerp(sx[s], T[0], l) + w; P[o + 1] = lerp(sx[s + 1], T[1], l) - Math.abs(w) * 0.4; P[o + 2] = T[2];
  });
  const BK = b.buckets;
  BK.forEach((k) => (k.length = 0));
  const HE = g.meshEdges, FD = g.fade, HW = g.weight, estride = quality === 0 ? 4 : 2;
  for (let e = 0; e < HE.length; e += estride) {
    const a = HE[e], c = HE[e + 1];
    const l = Math.min(LC[a], LC[c]) * Math.min(FD[a], FD[c]) * Math.min(HW[a], HW[c]);
    if (l > 0.02) BK[Math.min(3, (l * 4) | 0)].push(a, c);
  }
  ctx.lineWidth = 0.75;
  BK.forEach((k, bi) => {
    if (!k.length) return;
    ctx.strokeStyle = `rgba(${C.star},${0.3 * ((bi + 1) / 4) ** 2})`;
    ctx.beginPath();
    for (let j = 0; j < k.length; j += 2) {
      const A = k[j] * 3, B = k[j + 1] * 3;
      ctx.moveTo(P[A], P[A + 1]); ctx.lineTo(P[B], P[B + 1]);
    }
    ctx.stroke();
  });
  // vertex dots (skipped at low quality)
  if (quality > 0) {
    for (let i = 0; i < g.featureStart; i++) {
      const l = LC[i] * FD[i];
      if (l < 0.02) continue;
      const z = P[i * 3 + 2];
      ctx.fillStyle = `rgba(${C.light},${cl(l * 12) * FD[i] * HW[i] * (0.3 + 0.45 * cl(z + 0.5))})`;
      ctx.beginPath(); ctx.arc(P[i * 3], P[i * 3 + 1], 0.9 + cl(z + 0.4) * 0.6 + (1 - LC[i]) * 0.8, 0, TAU); ctx.fill();
    }
  }

  // mind network, behind the face
  const { J, ix } = b, M = g.inner.length;
  g.mind.forEach((v, j) => {
    P3(v, T, 0);
    const l = sm(cl((m - 0.3 - j * 0.015) / 0.45)), s = (j % M) * 3;
    J[j * 3] = lerp(ix[s], T[0], l); J[j * 3 + 1] = lerp(ix[s + 1], T[1], l); J[j * 3 + 2] = l;
  });
  ctx.lineWidth = 0.9;
  for (const [a, c] of g.mindEdges) {
    const l = Math.min(J[a * 3 + 2], J[c * 3 + 2]);
    if (l < 0.02) continue;
    ctx.strokeStyle = `rgba(${C.light},${0.22 * l})`;
    ctx.beginPath(); ctx.moveTo(J[a * 3], J[a * 3 + 1]); ctx.lineTo(J[c * 3], J[c * 3 + 1]); ctx.stroke();
  }
  g.mind.forEach((_, j) => {
    const l = J[j * 3 + 2];
    if (l < 0.02) return;
    const core = j === 0 || j === 11, pu = core ? 0.5 + 0.5 * Math.sin(t * 3 + j) : 0;
    const fill = `rgba(${C.bright},${(core ? 0.8 : 0.45) * l})`;
    if (core) glowDot(ctx, J[j * 3], J[j * 3 + 1], 2.6 + pu * 1.4, fill, 14, quality);
    else { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(J[j * 3], J[j * 3 + 1], 1.6, 0, TAU); ctx.fill(); }
  });

  // hatched planes: hair, brows, lips, shadows; they ink in as the portrait completes
  const pf = sg(m, 0.8, 1);
  if (pf > 0) {
    const gap = Math.max(2.2, S * 0.011) * (quality === 1 ? 1.7 : 1);
    const pts: number[] = [];
    for (const pl of g.planes) {
      pts.length = 0;
      pl.v.forEach((v, i) => P3(v, pts, i * 3));
      ctx.beginPath();
      for (let i = 0; i < pl.v.length; i++) { const x = pts[i * 3], y = pts[i * 3 + 1]; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.closePath();
      if (pl.f) { ctx.fillStyle = `rgba(${C.ink},${pl.f * pf})`; ctx.fill(); }
      if (pl.w) { ctx.strokeStyle = `rgba(${C.light},${pl.w * pf * pl.d})`; ctx.lineWidth = 1; ctx.stroke(); }
      if (quality === 0) continue;
      ctx.save();
      ctx.clip();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < pl.v.length; i++) {
        const x = pts[i * 3], y = pts[i * 3 + 1];
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      const qx = (x0 + x1) / 2, qy = (y0 + y1) / 2, r = Math.hypot(x1 - x0, y1 - y0) / 2, c = Math.cos(pl.a), s = Math.sin(pl.a);
      ctx.beginPath();
      for (let o = -r; o <= r; o += gap * pl.g) {
        const px = qx - s * o, py = qy + c * o;
        ctx.moveTo(px - c * r, py - s * r); ctx.lineTo(px + c * r, py + s * r);
      }
      ctx.strokeStyle = `rgba(${C.star},${pl.o * pf * pl.d})`;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.restore();
    }
  }

  // feature and facet lines: brighter strokes over the mesh
  ctx.lineJoin = "round";
  const FE = g.featureEdges;
  for (let e = 0, n = 0; e < FE.length; e += 2, n++) {
    const a = FE[e], c = FE[e + 1];
    const l = Math.min(LC[a], LC[c]) * Math.min(FD[a], FD[c]);
    if (l < 0.02) continue;
    const w = g.featureWeight[n];
    ctx.lineWidth = w < 1 ? 0.8 : 1.25;
    ctx.strokeStyle = `rgba(${C.light},${0.85 * w * l * (0.55 + 0.45 * cl(P[a * 3 + 2] + 0.6))})`;
    ctx.beginPath(); ctx.moveTo(P[a * 3], P[a * 3 + 1]); ctx.lineTo(P[c * 3], P[c * 3 + 1]); ctx.stroke();
  }
  // eyes light up once the face is complete
  const eg = sg(m, 0.9, 1);
  if (eg > 0) g.eyes.forEach((v) => { P3(v, T, 0); glowDot(ctx, T[0], T[1], 1.2 + S * 0.005, `rgba(${C.bright},${eg})`, 10, quality); });

  // scan line at the assembly front
  const yb = ((m - 0.25) / 0.5) * 1.65 - 1;
  if (m < 1 && yb > -1 && yb < 0.65) {
    const Y = hy + yb * S, lg = ctx.createLinearGradient(HX - 0.9 * S, 0, HX + 0.9 * S, 0);
    lg.addColorStop(0, `rgba(${C.star},0)`);
    lg.addColorStop(0.5, `rgba(${C.light},${0.55 * Math.sin(Math.PI * m)})`);
    lg.addColorStop(1, `rgba(${C.star},0)`);
    ctx.strokeStyle = lg;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(HX - 0.9 * S, Y); ctx.lineTo(HX + 0.9 * S, Y); ctx.stroke();
  }

  // skills ring: front half and sparks
  if (hv > 0.01) {
    ctx.strokeStyle = `rgba(${C.star},${0.75 * hv})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(HX, ry, RA, RB, 0, 0, Math.PI * hv); ctx.stroke();
    for (let i = 0; i < 2; i++) {
      const th = t * 0.9 + i * Math.PI, dp = (Math.sin(th) + 1) / 2;
      glowDot(ctx, HX + Math.cos(th) * RA, ry + Math.sin(th) * RB, 1.6 + dp * 1.2, `rgba(${C.light},${sg(hv, 0.9, 1) * (0.3 + 0.7 * dp)})`, 12, quality);
    }
  }
}
