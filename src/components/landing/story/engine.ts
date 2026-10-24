import { cl } from "./math";
import { getGeometry } from "./geometry";
import { drawOrb, drawRings, makeBuffers, projectOrb, type Quality } from "./draw-orb";
import { drawFigure } from "./draw-figure";
import { bindOverlays, layoutOverlays, updateOverlays } from "./overlays";
import { CHAPTERS, FOLLOW, STORY_UNITS, computeFrame, computeLayout, type Layout } from "./timeline";

export interface StoryElements {
  main: HTMLDivElement;
  stage: HTMLDivElement;
  canvas: HTMLCanvasElement;
  svg: SVGSVGElement;
  fill: HTMLElement | null;
  dots: HTMLElement[];
}

const DPR_CAP: Record<Quality, number> = { 0: 1.25, 1: 1.5, 2: 2 };

/** Start lower on phones / low-end devices; the monitor below adapts from there. */
function initialQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (innerWidth < 768 || (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4) return 1;
  return 2;
}

/**
 * Runs the story on its elements and returns a cleanup. `animated` = full effects: a rAF loop with the reference's
 * eased scroll follow (frame-rate independent), pointer parallax and adaptive quality. Otherwise (reduced motion / reduced or no effects): no loop —
 * each scroll renders a static snapshot of the nearest chapter. Pauses offscreen and in hidden tabs; full cleanup.
 */
export function runStory(el: StoryElements, animated: boolean, onVisible: (v: boolean) => void): () => void {
  const { main, stage, canvas, svg } = el;
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const g = getGeometry();
  const b = makeBuffers(g);
  const ov = bindOverlays(stage, svg, el.fill, el.dots);
  let quality: Quality = animated ? initialQuality() : 2;
  let L: Layout = computeLayout(stage.clientWidth, stage.clientHeight);

  const size = () => {
    const w = stage.clientWidth, h = stage.clientHeight, d = Math.min(devicePixelRatio || 1, DPR_CAP[quality]);
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    L = computeLayout(w, h);
    layoutOverlays(ov, L);
  };
  size();

  const progress = () => {
    const top = main.getBoundingClientRect().top;
    return cl(-top / Math.max(1, main.offsetHeight - innerHeight)) * STORY_UNITS;
  };

  let sp = progress(), mx = 0, my = 0, tx = 0, ty = 0, t = 0;
  const render = (spNow: number, time: number) => {
    const f = computeFrame(spNow, time, mx, my, L);
    updateOverlays(ov, f, L);
    ctx.clearRect(0, 0, L.W, L.H);
    projectOrb(g, f, b);
    drawOrb(ctx, g, f, b, quality);
    drawFigure(ctx, g, f, L, b, quality);
    drawRings(ctx, g, f, true, quality);
  };

  // ---- static snapshots (reduced) -------------------------------------------------
  const snapshot = () => {
    const p = progress();
    const near = CHAPTERS.reduce((best, c) => (Math.abs(c.at - p) < Math.abs(best - p) ? c.at : best), 0 as number);
    render(near, 0);
  };

  // ---- animated loop --------------------------------------------------------------
  let raf = 0, last = 0, visible = true, interval = 16, cost = 4, slow = 0, fast = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
    if (last) interval = interval * 0.9 + (now - last) * 0.1;
    last = now;
    t += dt;
    const k = 1 - Math.pow(1 - FOLLOW, dt * 60);
    sp += (progress() - sp) * k;
    mx += (tx - mx) * (1 - Math.pow(0.95, dt * 60));
    my += (ty - my) * (1 - Math.pow(0.95, dt * 60));
    const t0 = performance.now();
    render(sp, t);
    cost = cost * 0.9 + (performance.now() - t0) * 0.1;
    // adaptive quality: drop after ~1s of struggling, recover after ~6s of headroom
    if (interval > 21 || cost > 10) { slow++; fast = 0; } else if (interval < 18 && cost < 4) { fast++; slow = 0; } else { slow = 0; fast = 0; }
    if (slow > 60 && quality > 0) { quality = (quality - 1) as Quality; slow = 0; size(); }
    if (fast > 360 && quality < initialQuality()) { quality = (quality + 1) as Quality; fast = 0; size(); }
  };
  const start = () => { if (animated && !raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(tick); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  let scrollRaf = 0;
  const onScroll = () => { if (!animated && !scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; snapshot(); }); };
  const onPointer = (e: PointerEvent) => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; };
  let resizeTimer = 0;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(() => { size(); if (!animated) snapshot(); }, 120); };
  const onVis = () => (document.hidden ? stop() : start());
  // render loop: runs while any part of the story is on screen
  const io = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
    if (visible) start(); else stop();
  });
  // progress nav: shown only while the story fills the middle of the viewport
  const navIo = new IntersectionObserver(([e]) => onVisible(!!e?.isIntersecting), { rootMargin: "-45% 0px -45% 0px" });
  navIo.observe(main);

  io.observe(main);
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onScroll, { passive: true });
  if (animated) window.addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("visibilitychange", onVis);
  if (animated) start(); else snapshot();

  return () => {
    stop();
    cancelAnimationFrame(scrollRaf);
    clearTimeout(resizeTimer);
    io.disconnect();
    navIo.disconnect();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pointermove", onPointer);
    document.removeEventListener("visibilitychange", onVis);
  };
}
