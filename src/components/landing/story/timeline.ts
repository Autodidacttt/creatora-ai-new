/**
 * Scene timing and layout. Progress `sp` runs 0 → STORY_UNITS (the reference ran 0 → 1; everything up to the
 * "Rights" scene keeps its original timing, then two new scenes are inserted before the final call to action).
 * `ps` is the reference's eased first-half progress (orb → network → creator → brief).
 */
import { cl, lerp, sg, sm, win } from "./math";

export const STORY_UNITS = 1.26;
/** Scroll length of the sticky story (the reference used 1200vh for 1 unit; slightly tighter per unit here). */
export const STORY_VH = 1380;
/** Eased scroll follow per 60 fps frame (the reference's `sp += (p - sp) * .09`) */
export const FOLLOW = 0.09;

/** Scene windows: [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd] on sp (or ps where noted) */
export const SCENES = {
  intro: { ps: [-1, 0, 0.1, 0.16] },
  network: { ps: [0.17, 0.21, 0.28, 0.33] },
  creator: { ps: [0.4, 0.44, 0.72, 0.76] },
  brief: { psIn: [0.78, 0.82], spOut: [0.55, 0.58] },
  proof: { sp: [0.58, 0.62, 0.76, 0.79] },
  rights: { sp: [0.79, 0.82, 0.9, 0.92] },
  verified: { sp: [0.93, 0.96, 1.04, 1.06] },
  release: { sp: [1.07, 1.1, 1.19, 1.21] },
  cta: { sp: [1.215, 1.25] },
  /** the orb shrinks away as the call to action arrives */
  finish: [1.19, 1.25],
  /** amber pulse rings when a new chapter lands */
  flashes: [0.58, 0.79, 0.93, 1.07, 1.21],
} as const;

/** Chapters for the progress dots and the reduced-motion snapshots: where each scene is fully shown (sp). */
export const CHAPTERS = [
  { id: "intro", label: "Hire the minds behind the models", at: 0 },
  { id: "network", label: "Every creator is a living network", at: 0.15 },
  { id: "creator", label: "A creator's tools and workflow", at: 0.414 },
  { id: "brief", label: "Describe the brief, get ranked creators", at: 0.537 },
  { id: "proof", label: "See how each piece was made", at: 0.735 },
  { id: "rights", label: "Rights and tools, stated up front", at: 0.895 },
  { id: "verified", label: "Verified people and companies", at: 1.035 },
  { id: "release", label: "Fund, deliver, release", at: 1.185 },
  { id: "cta", label: "Start with the work", at: STORY_UNITS },
] as const;

/** First-half progress, exactly as the reference */
export const psOf = (sp: number) => sg(sp, 0, 0.54) * 0.9;

export interface Layout {
  W: number; H: number;
  /** bust scale and anchor, skills ring radii and centre */
  S: number; HX: number; HY: number; RA: number; RB: number; RY: number;
  capTop: number; wfTop: number;
  port: boolean;
}

export const HR = 1.36, BB = 0.72;

/** Bust layout: S = scale (head top −1, chest cut ~.66); the skills ring sits HR·S above centre. */
export function computeLayout(W: number, H: number): Layout {
  const top = 72, bot = 18, ra0 = Math.min(W / 2 - 60, 250);
  const S = Math.max(80, Math.min(270, (W - 40) / 1.5, (H - top - bot - ra0 * 0.27 - 176) / (HR + BB)));
  const RA = Math.min(W / 2 - 60, 250, S * 1.15), RB = RA * 0.27;
  const off = Math.max(0, (H - top - bot - ((HR + BB) * S + RB + 176)) / 2);
  const HX = W / 2, HY = top + off + RB + 18 + HR * S, RY = HY - HR * S;
  return { W, H, S, HX, HY, RA, RB, RY, capTop: HY + BB * S + 10, wfTop: HY + BB * S + 96, port: W < H * 0.95 };
}

/** Everything the drawing routines need for one frame, derived from progress + time + pointer. */
export interface Frame {
  sp: number; ps: number; t: number;
  /** orb: inner-network reveal, side position, size/centre, rotation */
  o: number; k: number; fin: number; R: number; ox: number; oy: number; ay: number; ax: number;
  /** creator: morph, orb remaining, figure formed, skills ring, hover bob */
  m: number; ob: number; fm: number; hv: number; hb: number;
  mx: number; my: number;
}

export function computeFrame(sp: number, t: number, mx: number, my: number, L: Layout): Frame {
  const ps = psOf(sp);
  const fin = sm(sg(sp, SCENES.finish[0], SCENES.finish[1]));
  const o = sm(sg(ps, 0.14, 0.3)) * (1 - fin);
  const k = sm(sg(ps, 0.72, 0.8)) * (1 - fin);
  const m = sg(ps, 0.3, 0.46) * (1 - sg(ps, 0.7, 0.78));
  const ob = 1 - sm(cl(m * 1.3));
  const fm = sm(sg(ps, 0.4, 0.46)) * (1 - sg(ps, 0.7, 0.74));
  const hv = sg(ps, 0.46, 0.52) * (1 - sg(ps, 0.7, 0.74));
  const hb = Math.sin(t * 1.3) * 3;
  const { W, H, port } = L;
  const hr = Math.min(W, H) * (port ? 0.25 : 0.2);
  const sr = port ? Math.min(W, H) * 0.085 : Math.min(W * 0.16, H * 0.17);
  const R = lerp(hr, sr, k) * (1 + 0.015 * Math.sin(t * 2));
  const ox = lerp(W / 2, port ? W / 2 : W * 0.2, k);
  const oy = lerp(H * (port ? 0.4 : 0.45), port ? H * 0.13 : H * 0.5, k);
  const ay = t * 0.25 + ps * 3 + sp * 2 + mx * 0.8;
  const ax = 0.35 + my * 0.4;
  return { sp, ps, t, o, k, fin, R, ox, oy, ay, ax, m, ob, fm, hv, hb, mx, my };
}

export { win };
