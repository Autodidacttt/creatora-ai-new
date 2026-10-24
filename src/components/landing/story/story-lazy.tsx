"use client";

import dynamic from "next/dynamic";
import { STORY } from "./copy";
import { STORY_VH } from "./timeline";
import s from "./classes";
import "./story.css";

/**
 * Server-rendered stand-in with the story's exact height and the intro headline in its final position — no layout
 * shift, and the LCP text paints before the canvas code arrives.
 */
function Placeholder() {
  return (
    <div className={s.main} style={{ height: `${STORY_VH}vh` }}>
      <div className={s.stage}>
        <section className={`${s.sc} ${s.bot}`} style={{ opacity: 1, visibility: "visible" }}>
          <h1>{STORY.intro.title} <em className={s.em}>{STORY.intro.accent}</em>.</h1>
          <p>{STORY.intro.body}</p>
        </section>
      </div>
    </div>
  );
}

/** Code-split, client-only scroll story (canvas logic never runs on the server). */
export const ScrollStoryLazy = dynamic(() => import("./scroll-story"), { ssr: false, loading: Placeholder });
