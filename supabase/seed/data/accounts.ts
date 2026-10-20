// The 10 demo accounts. All share DEMO_PASSWORD (documented in README).
// Demo media are royalty-free stock (Unsplash / Mixkit) standing in for AI-generated work.

export const DEMO_PASSWORD = "CreatoraDemo#2026";
export const DEMO_DOMAIN = "demo.creatora.ai";

export type Role = "creator" | "brand" | "admin";

export interface CreatorSeed {
  key: string;
  role: "creator";
  email: string;
  username: string;
  displayName: string;
  avatar: string; // unsplash photo id
  headline: string;
  bio: string;
  location: string;
  website?: string;
  links: Record<string, string>;
  experience: "emerging" | "intermediate" | "professional" | "expert";
  availability: "open" | "limited" | "booked";
  years: number;
  rate: [number, number];
  currency: string;
  workflowOverview: string;
  tools: [slug: string, proficiency: "learning" | "proficient" | "expert"][];
  skills: string[];
  categories: string[];
  contentTypes: string[];
  styles: string[];
  languages: string[];
  platforms: string[];
  experiences: { key: string; brand: string; project: string; year: number; description: string; link?: string }[];
  verified: boolean;
}

export interface BrandSeed {
  key: string;
  role: "brand";
  email: string;
  username: string;
  displayName: string;
  avatar: string;
  headline: string;
  bio: string;
  location: string;
  website?: string;
  links: Record<string, string>;
  company: string;
  industry: string;
  size: "1-10" | "11-50" | "51-200" | "201-1000" | "1000+";
  description: string;
}

export interface AdminSeed {
  key: string;
  role: "admin";
  email: string;
  username: string;
  displayName: string;
  avatar: string;
  headline: string;
  bio: string;
  location: string;
}

const email = (local: string) => `${local}@${DEMO_DOMAIN}`;

export const creators: CreatorSeed[] = [
  {
    key: "maya",
    role: "creator",
    email: email("maya"),
    username: "maya.okafor",
    displayName: "Maya Okafor",
    avatar: "1531746020798-e6953c6e8e04",
    headline: "AI filmmaker · narrative shorts & brand films",
    bio: "I direct short films where generative video does the heavy lifting and the story stays human. Former documentary editor, now building cinematic worlds with Runway, Kling and a lot of patience in the grade.",
    location: "London, UK",
    website: "https://mayaokafor.studio",
    links: { instagram: "https://instagram.com/maya.makes.films", youtube: "https://youtube.com/@mayaokafor" },
    experience: "expert",
    availability: "limited",
    years: 9,
    rate: [4500, 12000],
    currency: "GBP",
    workflowOverview:
      "Script and shot list in Claude → look development and keyframes in Midjourney → image-to-video in Runway and Kling → voice in ElevenLabs → edit and grade in DaVinci Resolve. Every shot keeps a prompt log so clients can audit provenance.",
    tools: [
      ["runway", "expert"],
      ["midjourney", "expert"],
      ["kling", "proficient"],
      ["elevenlabs", "proficient"],
      ["davinci", "expert"],
      ["claude", "proficient"],
    ],
    skills: ["storyboarding", "scriptwriting", "color-grading", "video-editing", "character-consistency", "prompt-engineering"],
    categories: ["ai-film", "music-video"],
    contentTypes: ["film", "short-video", "music-video"],
    styles: ["cinematic", "documentary", "surreal"],
    languages: ["en", "fr"],
    platforms: ["youtube", "instagram", "ctv"],
    experiences: [
      { key: "maya-exp-1", brand: "Northbound Rail", project: "‘Night Train’ brand film", year: 2025, description: "90-second hero film generated end to end; ran on CTV across the UK.", link: "https://mayaokafor.studio/night-train" },
      { key: "maya-exp-2", brand: "Saltmarsh Records", project: "Album trailer for ‘Low Tide’", year: 2024, description: "Narrative teaser cut for YouTube and Instagram Reels." },
    ],
    verified: true,
  },
  {
    key: "kenji",
    role: "creator",
    email: email("kenji"),
    username: "kenji.3d",
    displayName: "Kenji Watanabe",
    avatar: "1506794778202-cad84cf45f1d",
    headline: "3D animator · product worlds & abstract loops",
    bio: "Blender and Unreal at the core, AI on the edges. I build tactile 3D product worlds and hypnotic loops, then use Runway and Meshy to explore variations at a speed traditional pipelines can't match.",
    location: "Tokyo, Japan",
    website: "https://kenji3d.jp",
    links: { behance: "https://behance.net/kenji3d", instagram: "https://instagram.com/kenji.3d" },
    experience: "professional",
    availability: "open",
    years: 7,
    rate: [3000, 9000],
    currency: "USD",
    workflowOverview:
      "Moodboards in Midjourney → blockout and asset generation with Meshy → final modelling, lighting and simulation in Blender / Unreal → AI-assisted variations in Runway → comp in After Effects.",
    tools: [
      ["blender", "expert"],
      ["unreal", "proficient"],
      ["meshy", "proficient"],
      ["midjourney", "proficient"],
      ["runway", "proficient"],
      ["after-effects", "proficient"],
    ],
    skills: ["3d-modeling", "3d-animation", "product-viz", "compositing", "art-direction"],
    categories: ["3d-animation", "product-ads"],
    contentTypes: ["animation-3d", "product-ad", "visualizer"],
    styles: ["minimal", "abstract", "cyberpunk"],
    languages: ["ja", "en"],
    platforms: ["instagram", "youtube", "dooh"],
    experiences: [
      { key: "kenji-exp-1", brand: "Hoshino Instruments", project: "Synth launch product loop", year: 2025, description: "Six 3D loops for a hardware synth launch, adapted for DOOH screens in Shibuya." },
    ],
    verified: true,
  },
  {
    key: "sofia",
    role: "creator",
    email: email("sofia"),
    username: "sofia.marin",
    displayName: "Sofía Marín",
    avatar: "1534528741775-53994a69daeb",
    headline: "AI fashion visuals · lookbooks & editorial",
    bio: "Fashion photographer turned AI art director. I create campaign-ready lookbooks with consistent models, real garments and editorial lighting — then upscale them for print. Based in Barcelona, working worldwide.",
    location: "Barcelona, Spain",
    website: "https://sofiamarin.es",
    links: { instagram: "https://instagram.com/sofia.marin.ai", tiktok: "https://tiktok.com/@sofiamarin.ai" },
    experience: "expert",
    availability: "open",
    years: 11,
    rate: [3500, 10000],
    currency: "EUR",
    workflowOverview:
      "Garment photography on set → model and pose consistency with a trained LoRA in ComfyUI → scene generation in FLUX and Midjourney → retouch in Photoshop → upscale in Magnific → motion versions in Runway.",
    tools: [
      ["midjourney", "expert"],
      ["flux", "expert"],
      ["comfyui", "proficient"],
      ["magnific", "expert"],
      ["photoshop", "expert"],
      ["runway", "proficient"],
      ["krea", "proficient"],
    ],
    skills: ["art-direction", "character-consistency", "lora-training", "prompt-engineering", "color-grading", "upscaling"],
    categories: ["fashion", "social-ugc"],
    contentTypes: ["lookbook", "key-visual", "short-video"],
    styles: ["editorial", "photoreal", "retro"],
    languages: ["es", "en", "pt"],
    platforms: ["instagram", "tiktok", "pinterest"],
    experiences: [
      { key: "sofia-exp-1", brand: "Atelier Nova", project: "Holiday 2026 still-life key visuals", year: 2026, description: "Hero stills for the holiday capsule, delivered for paid social and web." },
      { key: "sofia-exp-2", brand: "Maré Swim", project: "SS25 virtual lookbook", year: 2025, description: "48-look AI lookbook with consistent models across three locations." },
    ],
    verified: true,
  },
  {
    key: "arjun",
    role: "creator",
    email: email("arjun"),
    username: "arjun.motion",
    displayName: "Arjun Mehta",
    avatar: "1539571696357-5a69c17a67c6",
    headline: "Motion designer · brand systems that move",
    bio: "I design motion systems for tech brands: gradients, type and particles that feel alive. AI helps me generate textures and test directions fast; After Effects and Cinema 4D keep it precise.",
    location: "Bengaluru, India",
    links: { instagram: "https://instagram.com/arjun.motion", linkedin: "https://linkedin.com/in/arjunmehta-motion" },
    experience: "intermediate",
    availability: "open",
    years: 4,
    rate: [1200, 4000],
    currency: "USD",
    workflowOverview:
      "Style frames in Midjourney → textures and gradients in Krea → 3D elements in Cinema 4D and Spline → animation and kinetic type in After Effects → AI voice-over in ElevenLabs when needed.",
    tools: [
      ["after-effects", "expert"],
      ["cinema4d", "proficient"],
      ["spline", "proficient"],
      ["midjourney", "proficient"],
      ["krea", "learning"],
      ["elevenlabs", "learning"],
    ],
    skills: ["motion-design", "typography", "3d-animation", "sound-design"],
    categories: ["motion-design", "product-ads"],
    contentTypes: ["explainer", "short-video", "animation-2d"],
    styles: ["minimal", "abstract"],
    languages: ["hi", "en"],
    platforms: ["linkedin", "youtube-shorts", "instagram", "web"],
    experiences: [
      { key: "arjun-exp-1", brand: "Ledgerline", project: "Fintech app explainer series", year: 2025, description: "Five 30-second explainers with a reusable motion toolkit." },
    ],
    verified: false,
  },
  {
    key: "lena",
    role: "creator",
    email: email("lena"),
    username: "lena.visuals",
    displayName: "Lena Fischer",
    avatar: "1517841905240-472988babdf9",
    headline: "Music video & live visuals · Berlin",
    bio: "I make music videos and tour visuals that move with the track. Generative video lets independent artists get festival-scale visuals; I handle the edit so every cut lands on the beat.",
    location: "Berlin, Germany",
    website: "https://lenafischer.de",
    links: { instagram: "https://instagram.com/lena.visuals", vimeo: "https://vimeo.com/lenavisuals" },
    experience: "professional",
    availability: "limited",
    years: 6,
    rate: [2500, 8000],
    currency: "EUR",
    workflowOverview:
      "Track analysis and beat map → looks in Stable Diffusion via ComfyUI → motion in Runway, Kling and Luma → stems and transitions in After Effects → final cut synced in Premiere Pro.",
    tools: [
      ["runway", "expert"],
      ["kling", "proficient"],
      ["luma", "proficient"],
      ["stable-diffusion", "proficient"],
      ["comfyui", "proficient"],
      ["after-effects", "proficient"],
      ["premiere", "expert"],
    ],
    skills: ["video-editing", "vfx", "compositing", "music-production", "comfyui-pipelines"],
    categories: ["music-video", "ai-film"],
    contentTypes: ["music-video", "visualizer", "short-video"],
    styles: ["surreal", "cyberpunk", "retro"],
    languages: ["de", "en"],
    platforms: ["youtube", "tiktok", "instagram"],
    experiences: [
      { key: "lena-exp-1", brand: "Kollektiv Ost", project: "Festival tour visuals 2025", year: 2025, description: "45 minutes of reactive visuals for a 12-date European tour." },
      { key: "lena-exp-2", brand: "Neon Garden (band)", project: "‘Static Hearts’ music video", year: 2024, description: "Fully generated music video; 1.2M YouTube views." },
    ],
    verified: false,
  },
  {
    key: "diego",
    role: "creator",
    email: email("diego"),
    username: "diego.ads",
    displayName: "Diego Santos",
    avatar: "1500648767791-00dcc994a43e",
    headline: "AI product ads · still life & performance creative",
    bio: "I help DTC brands test more creative, faster. Clean product still-life and short performance ads built with FLUX, Krea and Veo, finished by hand so the product is always accurate.",
    location: "São Paulo, Brazil",
    links: { instagram: "https://instagram.com/diego.ads", tiktok: "https://tiktok.com/@diegoads" },
    experience: "emerging",
    availability: "open",
    years: 2,
    rate: [600, 2500],
    currency: "USD",
    workflowOverview:
      "Product photographed on a turntable → scene generation in FLUX and Krea → product compositing and cleanup in Photoshop → upscale in Magnific → 6–15s motion versions in Veo and Runway.",
    tools: [
      ["flux", "proficient"],
      ["krea", "proficient"],
      ["magnific", "proficient"],
      ["photoshop", "proficient"],
      ["veo", "learning"],
      ["runway", "learning"],
    ],
    skills: ["product-viz", "prompt-engineering", "upscaling", "compositing"],
    categories: ["product-ads", "social-ugc"],
    contentTypes: ["product-ad", "key-visual", "short-video"],
    styles: ["minimal", "photoreal", "editorial"],
    languages: ["pt", "es", "en"],
    platforms: ["instagram", "tiktok", "web"],
    experiences: [
      { key: "diego-exp-1", brand: "Atelier Nova", project: "Holiday 2026 still-life key visuals", year: 2026, description: "Accessory still-life set for the holiday capsule." },
    ],
    verified: false,
  },
];

export const brands: BrandSeed[] = [
  {
    key: "atelier",
    role: "brand",
    email: email("atelier"),
    username: "ateliernova",
    displayName: "Atelier Nova",
    avatar: "1579546929518-9e396f3cc809",
    headline: "Independent fashion label · Paris",
    bio: "Atelier Nova makes small-batch ready-to-wear for a generation that shops on its phone. We work with AI creators to build campaigns that feel like cinema, not catalogues.",
    location: "Paris, France",
    website: "https://ateliernova.fr",
    links: { instagram: "https://instagram.com/ateliernova" },
    company: "Atelier Nova",
    industry: "Fashion & apparel",
    size: "11-50",
    description: "Small-batch ready-to-wear label selling direct to consumers across Europe.",
  },
  {
    key: "orbitone",
    role: "brand",
    email: email("orbitone"),
    username: "orbitone",
    displayName: "Orbitone",
    avatar: "1620121692029-d088224ddc74",
    headline: "Consumer audio & wearables",
    bio: "Orbitone designs headphones and earbuds for people who live with music on. We're launching the Arc line and looking for 3D and motion creators who can make sound visible.",
    location: "Austin, USA",
    website: "https://orbitone.audio",
    links: { youtube: "https://youtube.com/@orbitone", instagram: "https://instagram.com/orbitone" },
    company: "Orbitone Audio Inc.",
    industry: "Consumer electronics",
    size: "201-1000",
    description: "Consumer audio brand shipping headphones and earbuds in 30 countries.",
  },
  {
    key: "tidewell",
    role: "brand",
    email: email("tidewell"),
    username: "tidewell",
    displayName: "Tidewell Sparkling Tea",
    avatar: "1636955779321-819753cd1741",
    headline: "Sparkling tea, brewed cold",
    bio: "Tidewell is a sparkling tea brand born in Lisbon and now stocked across the Americas. Our campaigns live on TikTok and in music culture.",
    location: "Lisbon, Portugal",
    website: "https://tidewell.co",
    links: { tiktok: "https://tiktok.com/@tidewell", instagram: "https://instagram.com/tidewell" },
    company: "Tidewell Beverages",
    industry: "Food & beverage",
    size: "51-200",
    description: "Cold-brewed sparkling tea sold in Europe and the Americas.",
  },
];

export const admin: AdminSeed = {
  key: "admin",
  role: "admin",
  email: email("admin"),
  username: "creatora.team",
  displayName: "Noor Haddad",
  avatar: "1494790108377-be9c29b29330",
  headline: "Trust & Safety · Creatora",
  bio: "I review creator verifications and keep the marketplace safe.",
  location: "Remote",
};
