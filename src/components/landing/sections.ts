/** Landing section anchors (nav, footer). Kept out of client modules so server components can import it. */
export const SECTIONS = [
  { id: "how", label: "How it works" },
  { id: "features", label: "Features" },
  { id: "match", label: "Creators" },
  { id: "trust", label: "Trust" },
  { id: "stats", label: "Live stats" },
] as const;
