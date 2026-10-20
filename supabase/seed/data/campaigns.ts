// Briefs for the demo brands, with mixed statuses.

export interface CampaignSeed {
  key: string;
  brand: string;
  title: string;
  description: string;
  deliverables: string;
  contentType: string;
  style: string;
  category: string;
  aspects: string[];
  audience: string;
  budget: [number, number];
  currency: string;
  deadlineInDays: number;
  creatorsNeeded: number;
  usageRights: string[];
  territory: string;
  duration: "3_months" | "6_months" | "12_months" | "24_months" | "perpetual";
  exclusivity: "none" | "category" | "full";
  license: "non_exclusive" | "exclusive" | "buyout" | "limited";
  aiDisclosure: boolean;
  aiAssisted: boolean;
  status: "draft" | "active" | "completed";
  platforms: string[];
  tools: string[];
  skills: string[];
  languages: string[];
  daysAgo: number;
}

export const campaigns: CampaignSeed[] = [
  {
    key: "atelier-ss27",
    brand: "atelier",
    title: "SS27 drop: cinematic AI lookbook for Gen Z",
    description:
      "We're launching our SS27 capsule (14 looks) to a Gen Z audience on Instagram and TikTok. We want three AI creators to turn real garment photography into a cinematic, slightly surreal lookbook — consistent models, real fabrics, film-grade colour. Each creator owns one 'chapter' of the story.",
    deliverables: "Per creator: 6 hero stills (4:5), 3 vertical motion pieces (9:16, 6–12s), 1 cutdown for paid social.",
    contentType: "lookbook",
    style: "cinematic",
    category: "fashion",
    aspects: ["9:16", "4:5"],
    audience: "Gen Z (18–26) in France, UK and Spain who follow fashion creators on TikTok and Instagram",
    budget: [4000, 9000],
    currency: "EUR",
    deadlineInDays: 21,
    creatorsNeeded: 3,
    usageRights: ["organic_social", "paid_social", "web"],
    territory: "EU + UK",
    duration: "12_months",
    exclusivity: "category",
    license: "non_exclusive",
    aiDisclosure: true,
    aiAssisted: true,
    status: "active",
    platforms: ["instagram", "tiktok"],
    tools: ["midjourney", "runway", "flux"],
    skills: ["art-direction", "character-consistency", "color-grading"],
    languages: ["en", "fr"],
    daysAgo: 4,
  },
  {
    key: "atelier-holiday",
    brand: "atelier",
    title: "Holiday 2026 still-life key visuals",
    description:
      "Still-life key visuals for our holiday accessories capsule: scarves, gloves and leather goods styled in warm, editorial sets. Products must be pixel-accurate; sets can be generated.",
    deliverables: "20 still-life images (4:5 and 1:1), print-ready upscales for 6 of them.",
    contentType: "key-visual",
    style: "editorial",
    category: "product-ads",
    aspects: ["4:5", "1:1"],
    audience: "Gift shoppers 25–45 in France and Germany",
    budget: [2500, 5000],
    currency: "EUR",
    deadlineInDays: -40,
    creatorsNeeded: 2,
    usageRights: ["organic_social", "paid_social", "web", "ooh"],
    territory: "Europe",
    duration: "24_months",
    exclusivity: "none",
    license: "buyout",
    aiDisclosure: true,
    aiAssisted: false,
    status: "completed",
    platforms: ["instagram", "web"],
    tools: ["flux", "magnific", "photoshop"],
    skills: ["product-viz", "upscaling"],
    languages: ["en"],
    daysAgo: 95,
  },
  {
    key: "atelier-runway",
    brand: "atelier",
    title: "Runway show teaser (draft)",
    description:
      "Early draft: a 30-second teaser for our first runway show, mixing backstage footage with generated set extensions. Still deciding on format and budget.",
    deliverables: "1 x 30s teaser, 3 x 6s cutdowns.",
    contentType: "short-video",
    style: "cinematic",
    category: "fashion",
    aspects: ["9:16", "16:9"],
    audience: "Fashion press and existing customers",
    budget: [6000, 12000],
    currency: "EUR",
    deadlineInDays: 60,
    creatorsNeeded: 1,
    usageRights: ["organic_social"],
    territory: "worldwide",
    duration: "12_months",
    exclusivity: "none",
    license: "non_exclusive",
    aiDisclosure: true,
    aiAssisted: false,
    status: "draft",
    platforms: ["instagram", "youtube"],
    tools: ["runway"],
    skills: ["video-editing"],
    languages: [],
    daysAgo: 1,
  },
  {
    key: "orbitone-arc",
    brand: "orbitone",
    title: "Orbitone Arc launch film",
    description:
      "A 60-second hero film for the Arc over-ear headphones: make sound visible. We imagine the product inside abstract 3D worlds that react to music. Must be product-accurate (we'll supply CAD files) and finish in 4K.",
    deliverables: "1 x 60s hero (16:9, 4K), 1 x 30s cutdown, 3 x 9:16 social edits.",
    contentType: "product-ad",
    style: "cinematic",
    category: "3d-animation",
    aspects: ["16:9", "9:16"],
    audience: "Music lovers 20–40 in the US, Japan and Germany; audio enthusiasts",
    budget: [8000, 15000],
    currency: "USD",
    deadlineInDays: 30,
    creatorsNeeded: 1,
    usageRights: ["paid_social", "broadcast", "web"],
    territory: "worldwide",
    duration: "24_months",
    exclusivity: "category",
    license: "exclusive",
    aiDisclosure: true,
    aiAssisted: false,
    status: "active",
    platforms: ["youtube", "instagram", "ctv"],
    tools: ["blender", "unreal", "runway"],
    skills: ["3d-animation", "product-viz", "sound-design"],
    languages: ["en", "ja"],
    daysAgo: 10,
  },
  {
    key: "orbitone-buds",
    brand: "orbitone",
    title: "Arc Buds: 15s social cutdowns",
    description:
      "Fast, graphic 15-second spots for Arc Buds with kinetic type and gradient motion. We have the copy; we need a motion designer who can build a reusable template system.",
    deliverables: "6 x 15s vertical spots + editable After Effects template.",
    contentType: "short-video",
    style: "minimal",
    category: "motion-design",
    aspects: ["9:16", "1:1"],
    audience: "Commuters and gym-goers 18–34",
    budget: [2500, 5000],
    currency: "USD",
    deadlineInDays: 12,
    creatorsNeeded: 1,
    usageRights: ["organic_social", "paid_social"],
    territory: "North America",
    duration: "12_months",
    exclusivity: "none",
    license: "non_exclusive",
    aiDisclosure: false,
    aiAssisted: true,
    status: "active",
    platforms: ["tiktok", "youtube-shorts", "instagram"],
    tools: ["after-effects", "cinema4d"],
    skills: ["motion-design", "typography"],
    languages: ["en"],
    daysAgo: 6,
  },
  {
    key: "tidewell-summer",
    brand: "tidewell",
    title: "Summer of Tidewell: music-video style spot",
    description:
      "We're partnering with an emerging artist for our summer anthem and want a surreal, sun-drenched music-video style spot built around the track. Think fizzing colour, retro film textures, impossible beaches. Spanish and Portuguese versions needed.",
    deliverables: "1 x 45s music-video spot (16:9 + 9:16), 5 x 10s TikTok edits, lyric visualizer.",
    contentType: "music-video",
    style: "surreal",
    category: "music-video",
    aspects: ["9:16", "16:9"],
    audience: "18–30 in Brazil, Mexico and the US Hispanic market; festival-goers",
    budget: [5000, 10000],
    currency: "USD",
    deadlineInDays: 25,
    creatorsNeeded: 2,
    usageRights: ["organic_social", "paid_social", "ooh"],
    territory: "Americas",
    duration: "6_months",
    exclusivity: "category",
    license: "non_exclusive",
    aiDisclosure: true,
    aiAssisted: false,
    status: "active",
    platforms: ["tiktok", "instagram", "youtube"],
    tools: ["runway", "kling", "luma"],
    skills: ["video-editing", "compositing", "music-production"],
    languages: ["es", "pt"],
    daysAgo: 8,
  },
  {
    key: "tidewell-pos",
    brand: "tidewell",
    title: "In-store screen loops (draft)",
    description:
      "Draft brief: short silent loops for in-store digital screens showing cans in fizzing, sunlit scenes.",
    deliverables: "4 x 10s silent loops (9:16 and 16:9).",
    contentType: "visualizer",
    style: "photoreal",
    category: "product-ads",
    aspects: ["9:16", "16:9"],
    audience: "Grocery shoppers",
    budget: [1500, 3000],
    currency: "USD",
    deadlineInDays: 45,
    creatorsNeeded: 1,
    usageRights: ["ooh"],
    territory: "Portugal",
    duration: "6_months",
    exclusivity: "none",
    license: "limited",
    aiDisclosure: true,
    aiAssisted: false,
    status: "draft",
    platforms: ["dooh"],
    tools: ["veo"],
    skills: ["product-viz"],
    languages: [],
    daysAgo: 2,
  },
];
