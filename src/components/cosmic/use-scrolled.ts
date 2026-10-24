"use client";

import { useEffect, useState } from "react";

/** True once the window has scrolled past `threshold` px (rAF-throttled, passive). Drives scroll-linked glass headers. */
export function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let raf = 0;
    const update = () => { raf = 0; setScrolled(window.scrollY > threshold); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [threshold]);
  return scrolled;
}
