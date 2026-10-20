// Relationships between the demo accounts only.

export const follows: [follower: string, following: string][] = [
  ["maya", "lena"], ["lena", "maya"], ["kenji", "arjun"], ["arjun", "kenji"],
  ["sofia", "diego"], ["diego", "sofia"], ["arjun", "maya"], ["diego", "kenji"],
  ["lena", "sofia"], ["maya", "sofia"], ["kenji", "maya"],
  ["atelier", "sofia"], ["atelier", "diego"], ["atelier", "maya"],
  ["orbitone", "kenji"], ["orbitone", "arjun"],
  ["tidewell", "lena"], ["tidewell", "maya"],
];

// [user, post key]
export const likes: [string, string][] = [
  ["lena", "maya-lighthouse"], ["sofia", "maya-lighthouse"], ["kenji", "maya-lighthouse"], ["atelier", "maya-lighthouse"],
  ["arjun", "maya-desert"], ["lena", "maya-neon"], ["tidewell", "maya-tidal"], ["diego", "maya-pines"],
  ["arjun", "kenji-prism"], ["diego", "kenji-prism"], ["orbitone", "kenji-prism"], ["maya", "kenji-pills"],
  ["orbitone", "kenji-liquid"], ["arjun", "kenji-flow"],
  ["diego", "sofia-sunbeam"], ["lena", "sofia-sunbeam"], ["maya", "sofia-sunbeam"], ["atelier", "sofia-sunbeam"],
  ["atelier", "sofia-stripe"], ["kenji", "sofia-stripe"], ["diego", "sofia-capsule"], ["atelier", "sofia-burgundy"],
  ["kenji", "arjun-gradient"], ["orbitone", "arjun-gradient"], ["maya", "arjun-ink"],
  ["maya", "lena-afterglow"], ["sofia", "lena-afterglow"], ["tidewell", "lena-handsup"], ["maya", "lena-handsup"],
  ["kenji", "lena-nightdrive"], ["arjun", "lena-booth"],
  ["sofia", "diego-watch"], ["atelier", "diego-watch"], ["kenji", "diego-audio"], ["orbitone", "diego-audio"],
  ["sofia", "diego-ritual"],
];

export const saves: [string, string][] = [
  ["atelier", "sofia-sunbeam"], ["atelier", "maya-tidal"], ["orbitone", "kenji-liquid"],
  ["orbitone", "arjun-gradient"], ["tidewell", "lena-handsup"], ["lena", "maya-neon"], ["diego", "sofia-capsule"],
];

export const comments: [key: string, user: string, post: string, body: string, minutesAgo: number][] = [
  ["c1", "lena", "maya-lighthouse", "The way you held the keeper's face across 112 shots is unreal. What did your reference sheet look like?", 2500],
  ["c2", "maya", "maya-lighthouse", "@lena.visuals one master portrait, three angles, and the same seed family — happy to share the template.", 2400],
  ["c3", "atelier", "maya-lighthouse", "This is the tone we want for our runway teaser. Saving for the moodboard.", 1900],
  ["c4", "arjun", "kenji-prism", "That laser field + crystal is so clean. Cycles or Eevee?", 1500],
  ["c5", "kenji", "kenji-prism", "Cycles, 512 samples, then a light glow pass in AE.", 1400],
  ["c6", "diego", "sofia-sunbeam", "Garment colour is spot on — compositing the real fabric really shows.", 700],
  ["c7", "atelier", "sofia-stripe", "Colour blocking like this would work beautifully for SS27.", 3000],
  ["c8", "tidewell", "lena-handsup", "Love the energy. Would this style translate to a beverage spot?", 4100],
  ["c9", "lena", "lena-handsup", "@tidewell absolutely — sun-drenched version would be fun.", 4000],
  ["c10", "orbitone", "kenji-liquid", "Refraction study is exactly the vibe for Arc.", 6000],
  ["c11", "sofia", "diego-watch", "So crisp. Which upscale settings in Magnific?", 1200],
  ["c12", "maya", "arjun-ink", "Perfect transition library for title sequences.", 8000],
];

// Brand swipes (some left unswiped so the deck has cards to demo)
export const swipes: [user: string, creator: string, action: "swipe_right" | "swipe_left"][] = [
  ["atelier", "sofia", "swipe_right"],
  ["orbitone", "kenji", "swipe_right"],
  ["orbitone", "lena", "swipe_left"],
];

export const applications: [key: string, campaign: string, creator: string, pitch: string, rate: number | null, status: "pending" | "rejected"][] = [
  ["a1", "atelier-ss27", "sofia", "I've delivered AI lookbooks for Atelier Nova's holiday capsule and Maré Swim. I'd take the 'golden hour' chapter: real garment composites, consistent model LoRA, and Runway motion for the vertical pieces.", 7500, "pending"],
  ["a2", "atelier-ss27", "lena", "My music-video background would bring a rhythmic, surreal edge to the vertical motion pieces — think fabrics moving to the beat.", 5000, "pending"],
  ["a3", "orbitone-arc", "kenji", "Product worlds are my core work. I'd build the Arc inside reactive glass and light environments in Blender/Unreal, using your CAD for accuracy, with Runway for fast look variations.", 13500, "pending"],
  ["a4", "orbitone-buds", "arjun", "I build motion toolkits — Gradient Systems shipped 14 AE templates. I can turn your copy into a kinetic-type system you can reuse after launch.", 3800, "pending"],
  ["a5", "tidewell-summer", "lena", "Sun-drenched surreal music-video spots are exactly my lane, and I can cut ES/PT versions on the beat grid.", 8500, "pending"],
  ["a6", "tidewell-summer", "diego", "I can handle the product hero shots and TikTok cutdowns with accurate can renders.", 2500, "pending"],
];

export const shortlists: [campaign: string, creator: string, note: string][] = [
  ["atelier-ss27", "sofia", "Strong fashion portfolio and proven work with us."],
  ["orbitone-arc", "kenji", "Best 3D product world reel so far."],
  ["tidewell-summer", "lena", "Music video experience fits the anthem concept."],
];

// Hires: [campaign, creator, status, agreed amount (campaign currency), paid N days ago | null = payment pending]
// Only inserted when missing — later steps move these projects through the real workflow (see seed/workspace.ts).
export const selections: [campaign: string, creator: string, status: "hired" | "completed", amount: number, paidDaysAgo: number | null][] = [
  ["atelier-holiday", "sofia", "completed", 3800, 41],
  ["atelier-holiday", "diego", "completed", 1600, 38],
  ["orbitone-arc", "kenji", "hired", 12500, null],
];

export const savedOpportunities: [creator: string, campaign: string][] = [
  ["maya", "tidewell-summer"],
  ["kenji", "orbitone-buds"],
];

// Conversations: [key, a, b, messages: [sender, body, minutesAgo]]
export const conversations: [string, string, string, [string, string, number][]][] = [
  ["dm-atelier-sofia", "atelier", "sofia", [
    ["atelier", "Hi Sofía! Loved working with you on the holiday visuals. We just opened SS27 — would you be up for one of the chapters?", 3000],
    ["sofia", "Bonjour! Yes, absolutely. I applied this morning — I'd love the golden-hour chapter.", 2900],
    ["atelier", "Perfect. We'll send garment photography by Friday. Can you keep the same model LoRA from holiday?", 2800],
    ["sofia", "Yes, it's still trained and ready. I'll send three test frames once I have the garments.", 2700],
    ["atelier", "Shortlisted you — let's lock the chapter next week.", 600],
  ]],
  ["dm-orbitone-kenji", "orbitone", "kenji", [
    ["orbitone", "Kenji, your Liquid Glass study is basically our Arc moodboard. Do you work from CAD?", 5000],
    ["kenji", "Yes — STEP or OBJ both fine. I retopo in Blender so the product stays exact.", 4900],
    ["orbitone", "Great. Sending NDA + files today.", 4800],
    ["kenji", "Received, thanks. First look-dev frames by Monday.", 300],
  ]],
  ["dm-maya-lena", "maya", "lena", [
    ["lena", "Your Lighthouse short is stunning. Want to collab on a music video this winter?", 7000],
    ["maya", "Thank you! I'd love that — you take rhythm, I take story?", 6900],
    ["lena", "Deal. I'll send you the track this week.", 6800],
  ]],
  ["dm-tidewell-lena", "tidewell", "lena", [
    ["tidewell", "Hi Lena — thanks for applying to Summer of Tidewell. Could you share a rough treatment?", 900],
    ["lena", "Of course! I'll put together a one-pager with three looks by tomorrow.", 120],
  ]],
];

// Verification records: approved ones show as badges; pending ones appear in the admin queue.
export const verifications: {
  key: string;
  creator: string;
  type: "tool" | "workflow" | "past_work" | "identity";
  tool?: string;
  post?: string;
  experience?: string;
  title: string;
  evidenceUrl?: string;
  notes: string;
  status: "approved" | "pending";
}[] = [
  { key: "v1", creator: "maya", type: "tool", tool: "runway", title: "Runway — verified project history", evidenceUrl: "https://mayaokafor.studio/process", notes: "Shared Runway workspace export with 112 generations for The Last Lighthouse.", status: "approved" },
  { key: "v2", creator: "maya", type: "workflow", post: "maya-lighthouse", title: "Documented workflow: The Last Lighthouse", evidenceUrl: "https://mayaokafor.studio/lighthouse-breakdown", notes: "Prompt log, seeds and edit timeline reviewed.", status: "approved" },
  { key: "v3", creator: "maya", type: "identity", title: "Identity verified", notes: "Government ID checked by the trust team.", status: "approved" },
  { key: "v4", creator: "kenji", type: "tool", tool: "blender", title: "Blender — verified source files", evidenceUrl: "https://kenji3d.jp/prism-files", notes: ".blend files for Prism Monolith reviewed.", status: "approved" },
  { key: "v5", creator: "kenji", type: "identity", title: "Identity verified", notes: "Government ID checked by the trust team.", status: "approved" },
  { key: "v6", creator: "sofia", type: "tool", tool: "midjourney", title: "Midjourney — verified account history", evidenceUrl: "https://sofiamarin.es/process", notes: "Account gallery matches portfolio pieces.", status: "approved" },
  { key: "v7", creator: "sofia", type: "past_work", experience: "sofia-exp-1", title: "Atelier Nova — Holiday 2026 collaboration", notes: "Confirmed by Atelier Nova via the platform (completed campaign).", status: "approved" },
  { key: "v8", creator: "sofia", type: "workflow", post: "sofia-sunbeam", title: "Documented workflow: Sunbeam Set", evidenceUrl: "https://sofiamarin.es/sunbeam", notes: "ComfyUI graph and garment plates reviewed.", status: "approved" },
  { key: "v9", creator: "sofia", type: "identity", title: "Identity verified", notes: "Government ID checked by the trust team.", status: "approved" },
  { key: "v10", creator: "arjun", type: "tool", tool: "after-effects", title: "After Effects — toolkit files", evidenceUrl: "https://behance.net/arjunmehta", notes: "Submitted AE project for Gradient Systems.", status: "pending" },
  { key: "v11", creator: "lena", type: "past_work", experience: "lena-exp-2", title: "Neon Garden — ‘Static Hearts’ music video", evidenceUrl: "https://vimeo.com/lenavisuals", notes: "Label contact provided for confirmation.", status: "pending" },
  { key: "v12", creator: "diego", type: "identity", title: "Identity verification request", notes: "Submitted ID for review.", status: "pending" },
];

export const reports: { key: string; reporter: string; targetType: "post"; post: string; reason: "ip_infringement" | "misleading"; details: string }[] = [
  { key: "r1", reporter: "kenji", targetType: "post", post: "lena-booth", reason: "misleading", details: "Test report: description doesn't mention which parts were generated (demo moderation item)." },
];
