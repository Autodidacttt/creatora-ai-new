/**
 * Motion tokens — the one place to tune how Creatora moves. Framer Motion uses the springs directly; CSS (view
 * transitions, sheets, keyframes) uses the matching `linear()` curves exported to globals.css as --spring-* (generated
 * from the same stiffness/damping/mass, so both paths feel identical).
 */
export const SPRING = {
  /** App-open: a page or sheet growing out of the pressed icon/card (~420ms, slight overshoot) */
  open: { type: "spring", stiffness: 260, damping: 24, mass: 1 },
  /** Gliding indicators (nav, tabs, segments) */
  glide: { type: "spring", stiffness: 420, damping: 34, mass: 1 },
  /** Press feedback on icons and buttons */
  press: { type: "spring", stiffness: 600, damping: 30, mass: 0.6 },
  /** Reveals, counters, soft follow (magnetic, tilt) */
  gentle: { type: "spring", stiffness: 180, damping: 24, mass: 0.8 },
} as const;

export const DURATION = {
  /** Matches SPRING.open settling; used by the CSS view-transition and sheet animations */
  open: 0.42,
  fast: 0.16,
  reveal: 0.6,
} as const;

/** Expo-out for non-spring CSS/JS tweens */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** App-open geometry: how small the page starts and how round the growing clip is */
export const OPEN = { scale: 0.9, radius: 28, blur: 10 } as const;
