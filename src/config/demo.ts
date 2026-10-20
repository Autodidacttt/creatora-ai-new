// Seeded demo logins (see supabase/seed). Shown on the sign-in page as quick-fill shortcuts.
export const DEMO_PASSWORD = "CreatoraDemo#2026";

export const DEMO_LOGINS = [
  { email: "sofia@demo.creatora.ai", role: "Creator", hint: "Fashion visuals" },
  { email: "maya@demo.creatora.ai", role: "Creator", hint: "AI film" },
  { email: "atelier@demo.creatora.ai", role: "Brand", hint: "Fashion label" },
  { email: "orbitone@demo.creatora.ai", role: "Brand", hint: "Consumer tech" },
  { email: "admin@demo.creatora.ai", role: "Admin", hint: "Trust & safety" },
] as const;
