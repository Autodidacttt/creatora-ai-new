/**
 * Story copy, shared by the visual scenes and the visually hidden text version. Sample data is labelled as such:
 * scores are relevance estimates, never talent measures, and payments run in test mode.
 */
export const STORY = {
  intro: { title: "Hire the minds behind the", accent: "models", body: "Portfolios that show the tools, models and workflow behind every piece. Scroll to look inside." },
  network: { title: "Every creator is a living network.", body: "Tools, models and workflow, connected. Nothing hidden behind a thumbnail." },
  creator: {
    skills: ["Runway", "Midjourney", "ComfyUI", "ElevenLabs", "Kling", "Premiere"],
    name: "Aria Voss", role: "AI motion designer",
    meta: [["42", "projects"], ["6", "tools"], ["3", "workflows"]] as const,
    tag: "Sample profile · not verified",
    workflowTitle: "Her workflow",
    workflow: ["Brief", "Generate", "Refine", "Deliver"],
  },
  brief: {
    title: "Describe the brief. Get ranked creators.",
    text: "Need a 15-second neon product teaser for a sneaker drop. Runway and ComfyUI, with commercial usage rights.",
    rows: [
      { name: "Aria V.", score: 92, tools: "Runway · ComfyUI · commercial use" },
      { name: "Dev K.", score: 87, tools: "Kling · After Effects" },
      { name: "Mira S.", score: 81, tools: "Midjourney · Premiere" },
    ],
    note: "Sample data. Scores are relevance estimates, not talent measures.",
  },
  proof: {
    title: "See how each piece was made.",
    layers: [
      { title: "Prompt", body: "Neon sneaker, wet asphalt, slow push-in" },
      { title: "Model run", body: "Runway, four passes, seed saved" },
      { title: "Final frame", body: "Graded in Premiere, 1080p, 15 seconds" },
    ],
    note: "Sample project. A real profile shows every layer.",
  },
  rights: {
    title: "Rights and tools, stated up front.",
    checks: [
      { title: "Commercial use", body: "Licence terms attached to each piece" },
      { title: "Tools and models listed", body: "Nothing hidden behind a thumbnail" },
      { title: "Source files included", body: "Editable layers delivered with the final" },
    ],
    note: "Sample profile. The rights shown here are illustrative.",
  },
  verified: {
    title: "Verified people and companies.",
    checks: [
      { title: "Phone verified", body: "A one-time code, one number per account" },
      { title: "Identity verified", body: "ID reviewed by the trust team" },
      { title: "Verified company", body: "Confirmed by an official company contact" },
    ],
    note: "Sample profile. Every badge says what was checked and how.",
  },
  release: {
    title: "Fund, deliver, release.",
    steps: [
      { title: "Project funded", body: "Held in the test-mode escrow ledger" },
      { title: "Watermarked preview", body: "The brand reviews a protected preview" },
      { title: "Approved", body: "Or a revision is requested, with feedback" },
      { title: "Payment released", body: "A licence record is issued" },
      { title: "Clean files", body: "Originals unlock for download" },
    ],
    note: "Sample project. Payments run in test mode; no real money moves.",
  },
  cta: { title: "Start with the work, not the pitch.", body: "Briefs that capture format, style and usage rights. Matching that explains itself." },
} as const;
