"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEffects } from "@/components/cosmic/effects";
import { StoryScenes } from "./overlays";
import { StoryText } from "./story-text";
import { CHAPTERS, STORY_UNITS, STORY_VH } from "./timeline";
import { runStory } from "./engine";
import s from "./classes";

/**
 * The landing scroll story: a sticky stage (canvas + arrow layer + DOM scenes) driven by scroll progress, with a
 * progress indicator whose chapter dots are keyboard-reachable buttons. Loaded client-only (dynamic, ssr:false).
 */
export default function ScrollStory() {
  const { level } = useEffects();
  const animated = level === "full";
  const main = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const fill = useRef<HTMLElement>(null);
  const dots = useRef<HTMLElement[]>([]);
  const [inView, setInView] = useState(true);
  const onVisible = useCallback((v: boolean) => setInView(v), []);
  useEffect(() => {
    if (!main.current || !stage.current || !canvas.current || !svg.current) return;
    return runStory({ main: main.current, stage: stage.current, canvas: canvas.current, svg: svg.current, fill: fill.current, dots: dots.current }, animated, onVisible);
  }, [animated, onVisible]);

  const goTo = (at: number) => {
    const el = main.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const y = top + (at / STORY_UNITS) * (el.offsetHeight - window.innerHeight);
    window.scrollTo({ top: Math.ceil(y), behavior: animated ? "smooth" : "auto" });
  };

  return (
    <>
      <nav aria-label="Story chapters" className={s.prog} data-hidden={!inView}>
        <div className={s.track} aria-hidden><i ref={fill} /></div>
        <div className={s.dots}>
          {CHAPTERS.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={s.dot}
              ref={(el) => { if (el) dots.current[i] = el; }}
              aria-label={`Chapter ${i + 1} of ${CHAPTERS.length}: ${c.label}`}
              tabIndex={inView ? 0 : -1}
              onClick={() => goTo(c.at)}
            />
          ))}
        </div>
      </nav>
      <div ref={main} id="story" className={s.main} style={{ height: `${STORY_VH}vh` }}>
        <div ref={stage} className={s.stage}>
          <canvas ref={canvas} className={s.canvas} aria-hidden />
          <svg ref={svg} className={s.arrows} aria-hidden />
          <StoryScenes />
        </div>
      </div>
      <StoryText />
    </>
  );
}
