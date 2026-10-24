/**
 * DOM layer of the story: scene markup (aria-hidden — the text version lives in <StoryText/>, except the CTA links),
 * element binding, and the per-frame update. Writes are cached (only changed values touch the DOM) and arrow
 * geometry is read before any write in a frame, so the loop never forces layout mid-frame.
 */
import Link from "next/link";
import { sg, sm, win } from "./math";
import { STORY } from "./copy";
import { CHAPTERS, SCENES, STORY_UNITS, type Frame, type Layout } from "./timeline";
import s from "./classes";

const Check = () => (
  <svg viewBox="0 0 26 26" aria-hidden><circle cx="13" cy="13" r="11" pathLength={1} /><path d="M7.5 13.5l4 4 7-8" pathLength={1} /></svg>
);

export function StoryScenes() {
  const { intro, network, creator, brief, proof, release, cta } = STORY;
  return (
    <>
      <section aria-hidden className={`${s.sc} ${s.bot}`} data-scene="intro"><h1>{intro.title} <em className={s.em}>{intro.accent}</em>.</h1><p>{intro.body}</p></section>
      <section aria-hidden className={`${s.sc} ${s.bot}`} data-scene="network"><h2>{network.title}</h2><p>{network.body}</p></section>

      <div aria-hidden className={`${s.sc} ${s.hum}`} data-scene="creator">
        <ul className={s.skills}>{creator.skills.map((k) => <li key={k} className={s.skill} data-el="skill">{k}</li>)}</ul>
        <div className={s.cap} data-el="cap">
          <b>{creator.name}</b><span className={s.role}>{creator.role}</span>
          <div className={s.meta}>{creator.meta.map(([n, l], i) => <span key={l}>{i ? " · " : ""}<b>{n}</b> {l}</span>)}</div>
          <span className={s.tag}>{creator.tag}</span>
        </div>
        <div className={s.wf} data-el="wf">
          <h3>{creator.workflowTitle}</h3>
          <div className={s.flow}>{creator.workflow.map((w) => <div key={w} className={`glass ${s.st}`} data-el="st">{w}</div>)}</div>
        </div>
      </div>

      <div aria-hidden className={`${s.sc} ${s.col}`} data-scene="brief">
        <div className={s.match}>
          <h2>{brief.title}</h2>
          <div className={`glass ${s.card} ${s.brief}`} data-el="brief" />
          {brief.rows.map((r) => (
            <div key={r.name} className={`glass ${s.row}`} data-el="row">
              <b>{r.name}</b><em>{r.score}</em><span>{r.tools}</span>
              <div className={s.bar}><i data-v={r.score} /></div>
            </div>
          ))}
          <div className={s.note}>{brief.note}</div>
        </div>
      </div>

      <div aria-hidden className={`${s.sc} ${s.col}`} data-scene="proof">
        <div className={s.match}>
          <h2>{proof.title}</h2>
          <div className={s.stack}>{proof.layers.map((l) => <div key={l.title} className={`glass ${s.ly}`} data-el="layer"><b>{l.title}</b><span>{l.body}</span></div>)}</div>
          <div className={s.note}>{proof.note}</div>
        </div>
      </div>

      {(["rights", "verified"] as const).map((key) => (
        <div key={key} aria-hidden className={`${s.sc} ${s.col}`} data-scene={key}>
          <div className={s.match}>
            <h2>{STORY[key].title}</h2>
            {STORY[key].checks.map((c) => <div key={c.title} className={`glass ${s.ck}`} data-el={`ck-${key}`}><Check /><div><b>{c.title}</b><span>{c.body}</span></div></div>)}
            <div className={s.note}>{STORY[key].note}</div>
          </div>
        </div>
      ))}

      <div aria-hidden className={`${s.sc} ${s.col}`} data-scene="release">
        <div className={s.match}>
          <h2>{release.title}</h2>
          <div className={s.steps}>{release.steps.map((st) => <div key={st.title} className={`glass ${s.step}`} data-el="step"><i /><div><b>{st.title}</b><span>{st.body}</span></div></div>)}</div>
          <div className={s.note}>{release.note}</div>
        </div>
      </div>

      <section className={`${s.sc} ${s.bot}`} data-scene="cta" aria-labelledby="story-cta-title">
        <h2 id="story-cta-title">{cta.title}</h2><p>{cta.body}</p>
        <div className={s.btns}>
          <Link className={s.btn} href="/signup">Get started <i aria-hidden>↗</i></Link>
          <Link className={`${s.btn} ${s.ghost}`} href="/login">Try a demo account</Link>
        </div>
      </section>
      <div aria-hidden className={`${s.sc} ${s.hint}`} data-scene="hint">Scroll<i className="fx-motion" /></div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Binding + per-frame update
// ---------------------------------------------------------------------------
type ArrowKind = "right" | "down";
interface Arrow { from: HTMLElement; to: HTMLElement; kind: ArrowKind; win: [number, number]; src: "ps" | "sp"; vis: "creator" | "proof" | "release"; p: SVGPathElement; h: SVGPathElement; len: number }

export interface Overlays {
  scene: Record<string, HTMLElement>;
  cap: HTMLElement; wf: HTMLElement; wfTitle: HTMLElement;
  skills: HTMLElement[]; sts: HTMLElement[];
  brief: HTMLElement; rows: { el: HTMLElement; bar: HTMLElement; v: number }[];
  layers: HTMLElement[];
  checks: Record<"rights" | "verified", { el: HTMLElement; marks: SVGElement[] }[]>;
  steps: HTMLElement[];
  arrows: Arrow[];
  fill: HTMLElement | null;
  dots: HTMLElement[];
  cache: WeakMap<Element, Map<string, string>>;
}

export function bindOverlays(root: HTMLElement, svg: SVGSVGElement, fill: HTMLElement | null, dots: HTMLElement[]): Overlays {
  const all = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
  const one = (sel: string) => root.querySelector<HTMLElement>(sel)!;
  const scene: Record<string, HTMLElement> = {};
  all("[data-scene]").forEach((el) => { scene[el.dataset.scene!] = el; });
  const sts = all('[data-el="st"]'), layers = all('[data-el="layer"]'), steps = all('[data-el="step"]');
  const checks = (k: string) => all(`[data-el="ck-${k}"]`).map((el) => ({ el, marks: [...el.querySelectorAll<SVGElement>("circle,path")] }));

  svg.replaceChildren();
  const NS = "http://www.w3.org/2000/svg";
  const arrows: Arrow[] = [];
  const mk = (from: HTMLElement, to: HTMLElement, kind: ArrowKind, w: [number, number], src: Arrow["src"], vis: Arrow["vis"]) => {
    const p = document.createElementNS(NS, "path"), h = document.createElementNS(NS, "path");
    svg.append(p, h);
    arrows.push({ from, to, kind, win: w, src, vis, p, h, len: 0 });
  };
  sts.forEach((el, i) => { if (i < 3) mk(el, sts[i + 1], "right", [0.63 + i * 0.02, 0.67 + i * 0.02], "ps", "creator"); });
  layers.forEach((el, i) => { if (i < 2) mk(el, layers[i + 1], "down", [0.675 + i * 0.012, 0.715 + i * 0.012], "sp", "proof"); });
  steps.forEach((el, i) => { if (i < 4) mk(el, steps[i + 1], "down", [1.118 + i * 0.014, 1.14 + i * 0.014], "sp", "release"); });

  const wf = one('[data-el="wf"]');
  return {
    scene, cap: one('[data-el="cap"]'), wf, wfTitle: wf.firstElementChild as HTMLElement,
    skills: all('[data-el="skill"]'), sts,
    brief: one('[data-el="brief"]'),
    rows: all('[data-el="row"]').map((el) => { const bar = el.querySelector<HTMLElement>("i")!; return { el, bar, v: Number(bar.dataset.v) }; }),
    layers, checks: { rights: checks("rights"), verified: checks("verified") }, steps, arrows,
    fill, dots, cache: new WeakMap(),
  };
}

/** Positions that depend on the layout only (on resize) */
export function layoutOverlays(o: Overlays, L: Layout) {
  o.cap.style.top = `${L.capTop}px`;
  o.wf.style.top = `${L.wfTop}px`;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function updateOverlays(o: Overlays, f: Frame, L: Layout) {
  const { sp, ps, t, hb } = f;
  const set = (el: Element, prop: string, val: string) => {
    let m = o.cache.get(el);
    if (!m) o.cache.set(el, (m = new Map()));
    if (m.get(prop) === val) return;
    m.set(prop, val);
    (el as HTMLElement).style.setProperty(prop, val);
  };
  const show = (el: HTMLElement, v: number, dy = 14) => {
    const a = r3(v);
    set(el, "opacity", String(a));
    set(el, "visibility", a < 0.01 ? "hidden" : "visible");
    set(el, "transform", `translateY(${r3((1 - a) * dy)}px)`);
    set(el, "pointer-events", a > 0.6 ? "auto" : "none");
  };

  // visibility of each scene
  const colv = 1 - sg(ps, 0.72, 0.76);
  const v = {
    creator: sg(ps, 0.4, 0.44) * colv,
    proof: win(sp, ...SCENES.proof.sp),
    release: win(sp, ...SCENES.release.sp),
  };

  // read phase: arrow geometry for visible arrows (before any write this frame)
  const geo = o.arrows.map((a) => {
    const g = sg(a.src === "ps" ? ps : sp, a.win[0], a.win[1]) * (a.vis === "creator" ? colv : v[a.vis]);
    return g > 0 ? { g, f: a.from.getBoundingClientRect(), to: a.to.getBoundingClientRect() } : { g: 0 };
  });

  // write phase
  show(o.scene.intro, win(ps, ...SCENES.intro.ps));
  show(o.scene.network, win(ps, ...SCENES.network.ps));
  show(o.scene.creator, v.creator, 0);
  show(o.scene.brief, sg(ps, ...SCENES.brief.psIn) * (1 - sg(sp, ...SCENES.brief.spOut)), 10);
  show(o.scene.proof, v.proof, 10);
  show(o.scene.rights, win(sp, ...SCENES.rights.sp), 10);
  show(o.scene.verified, win(sp, ...SCENES.verified.sp), 10);
  show(o.scene.release, v.release, 10);
  show(o.scene.cta, sg(sp, ...SCENES.cta.sp), 14);
  show(o.scene.hint, 1 - sg(ps, 0.02, 0.07), 0);
  if (o.fill) set(o.fill, "height", `${r3((sp / STORY_UNITS) * 100)}%`);
  const chapter = CHAPTERS.reduce((best, c, i) => (sp >= c.at - 0.04 ? i : best), 0);
  o.dots.forEach((d, i) => {
    const on = i === chapter;
    if ((d.getAttribute("aria-current") === "step") === on) return;
    if (on) d.setAttribute("aria-current", "step"); else d.removeAttribute("aria-current");
  });

  // creator: caption, orbiting skills, workflow
  if (v.creator > 0) {
    set(o.cap, "opacity", String(r3(sg(ps, 0.44, 0.5))));
    const rot = t * 0.16 + ps * 3, n = o.skills.length;
    o.skills.forEach((c, i) => {
      const th = (i / n) * Math.PI * 2 + rot, dp = (Math.sin(th) + 1) / 2;
      set(c, "opacity", String(r3(sg(ps, 0.5 + i * 0.012, 0.54 + i * 0.012) * (0.35 + 0.65 * dp))));
      set(c, "z-index", String(10 + Math.round(dp * 10)));
      set(c, "transform", `translate(${(L.HX + Math.cos(th) * L.RA).toFixed(1)}px,${(L.RY + hb + Math.sin(th) * L.RB).toFixed(1)}px) translate(-50%,-50%) scale(${r3(0.78 + 0.22 * dp)})`);
    });
    set(o.wfTitle, "opacity", String(r3(sg(ps, 0.57, 0.61))));
    o.sts.forEach((el, i) => set(el, "opacity", String(r3(sg(ps, 0.6 + i * 0.02, 0.64 + i * 0.02)))));
  }

  // brief → ranked creators
  const ty = sg(ps, 0.79, 0.84), text = STORY.brief.text;
  const typed = text.slice(0, Math.floor(text.length * ty)) + (ty < 1 ? "▍" : "");
  if (o.brief.textContent !== typed) o.brief.textContent = typed;
  o.rows.forEach((r, i) => {
    const g = sg(ps, 0.83 + i * 0.015, 0.86 + i * 0.015);
    set(r.el, "opacity", String(r3(g)));
    set(r.bar, "width", `${r3(r.v * g)}%`);
  });

  // proof layers unfold
  o.layers.forEach((l, i) => {
    const g = sm(sg(sp, 0.62 + i * 0.012, 0.665 + i * 0.012));
    set(l, "transform", `translateY(${r3(g * i * 92)}px) rotateX(${r3((1 - g) * -14)}deg) scale(${r3(1 - (1 - g) * i * 0.04)})`);
    set(l, "opacity", String(i ? r3(g) : 1));
  });

  // rights + verification checks draw in
  const checks = (list: Overlays["checks"]["rights"], start: number) => list.forEach((c, i) => {
    const g = sg(sp, start + i * 0.02, start + 0.03 + i * 0.02);
    set(c.el, "opacity", String(r3(g)));
    set(c.el, "transform", `translateX(${r3((1 - g) * 18)}px)`);
    c.marks.forEach((q, j) => set(q, "stroke-dashoffset", String(r3(1 - sg(g, j * 0.5, j * 0.5 + 0.5)))));
  });
  checks(o.checks.rights, 0.82);
  checks(o.checks.verified, 0.96);

  // release pipeline: each step lands, then lights up when the next one starts
  o.steps.forEach((el, i) => {
    const g = sg(sp, 1.1 + i * 0.014, 1.125 + i * 0.014);
    set(el, "opacity", String(r3(g)));
    set(el, "transform", `translateY(${r3((1 - g) * 10)}px)`);
    const done = String(g >= 1);
    if (el.dataset.done !== done) el.dataset.done = done;
  });

  // arrows (geometry measured above)
  o.arrows.forEach((a, i) => {
    const m = geo[i];
    if (!m.g || !("f" in m) || !m.f || !m.to) {
      set(a.p, "opacity", "0");
      set(a.h, "opacity", "0");
      return;
    }
    const F = m.f, T = m.to;
    let d: string, hd: string;
    if (a.kind === "down") {
      const x1 = F.left + F.width / 2, y1 = F.bottom, x2 = T.left + T.width / 2, y2 = T.top - 2;
      d = `M${x1} ${y1}C${x1} ${y1 + 22},${x2} ${y2 - 22},${x2} ${y2}`;
      hd = `M${x2 - 4} ${y2 - 6}L${x2} ${y2}L${x2 + 4} ${y2 - 6}`;
    } else {
      const x1 = F.right + 3, x2 = T.left - 2, y = F.top + F.height / 2;
      d = `M${x1} ${y}L${x2} ${y}`;
      hd = `M${x2 - 5} ${y - 4}L${x2} ${y}L${x2 - 5} ${y + 4}`;
    }
    if (a.p.getAttribute("d") !== d) { a.p.setAttribute("d", d); a.len = a.p.getTotalLength?.() ?? 80; }
    a.h.setAttribute("d", hd);
    set(a.p, "stroke-dasharray", String(r3(a.len)));
    set(a.p, "stroke-dashoffset", String(r3(a.len * (1 - m.g))));
    set(a.p, "opacity", "1");
    set(a.h, "opacity", String(r3(sg(m.g, 0.85, 1))));
  });
}
