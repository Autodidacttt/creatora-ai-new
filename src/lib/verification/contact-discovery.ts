import "server-only";
import { z } from "zod";
import { getGemini, withModelFallback } from "@/lib/ai/gemini";
import { verificationSettings } from "./settings";

/** Only company-level public data goes to the AI — never the applicant's name, phone, email or ID data. */
export type CompanyQuery = { company_name: string; website_domain: string; industry: string | null; address: string };

export type FoundContact = {
  source: "gemini" | "demo_directory";
  name: string | null;
  role: string;
  source_url: string;
  source_title: string;
  public_business_email: string | null;
  note: string | null;
};

const contactSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  role: z.string().min(1).max(120),
  source_url: z.string().url().max(1000),
  source_title: z.string().max(200).optional().default(""),
  public_business_email: z.string().email().max(254).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});
const resultSchema = z.object({ contacts: z.array(contactSchema).max(5), no_reliable_contact: z.boolean().optional() });

export class DiscoveryDisabled extends Error {}

/**
 * Gemini with Google Search grounding. Rules enforced in code, not just the prompt: every contact must cite a URL
 * that grounding actually returned; e-mails must appear on the cited domain's page domain or the company domain
 * and are never constructed; personal profiles (LinkedIn etc.) are dropped.
 */
export async function discoverContacts(q: CompanyQuery): Promise<{ contacts: FoundContact[]; model: string | null; note: string }> {
  if (!verificationSettings().contactDiscovery) throw new DiscoveryDisabled("AI contact discovery is turned off (AI_CONTACT_DISCOVERY_ENABLED).");
  const ai = getGemini();
  if (!ai) throw new DiscoveryDisabled("No GEMINI_API_KEY configured.");
  let used = "";
  const res = await withModelFallback((model) => {
    used = model;
    return ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: [
        `Company: ${q.company_name}`, `Website domain: ${q.website_domain}`, `Industry: ${q.industry ?? "unknown"}`, `Address: ${q.address}`,
      ].join("\n") }] }],
      config: {
        tools: [{ googleSearch: {} }],
        abortSignal: AbortSignal.timeout(40_000),
        systemInstruction: [
          "You help a marketplace's trust team find an OFFICIAL business contact for the company above, to confirm whether someone may represent it.",
          "Search the web. Only use public business information from the company's own website, official press/contact pages or reputable business registries.",
          "Prefer roles like legal, compliance, HR, partnerships, press or general contact. Never return personal phone numbers or personal addresses.",
          "NEVER guess or construct an email address: only include public_business_email if it appears verbatim on the cited page.",
          "Do not use or link LinkedIn or social-media profiles of individuals.",
          'Answer ONLY with JSON: {"contacts":[{"name":string|null,"role":string,"source_url":string,"source_title":string,"public_business_email":string|null,"note":string|null}],"no_reliable_contact":boolean}.',
          'If nothing reliable is found, answer {"contacts":[],"no_reliable_contact":true}.',
        ].join("\n"),
      },
    });
  });
  const grounded = new Map<string, string>();
  for (const c of res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    if (c.web?.uri) grounded.set(c.web.uri, c.web.title ?? "");
  }
  const text = (res.text ?? "").replace(/^```(?:json)?|```$/gm, "").trim();
  const parsed = resultSchema.safeParse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1) || "{}"));
  if (!parsed.success) return { contacts: [], model: used, note: "The AI answer couldn't be validated — no reliable contact found." };
  const companyDomain = q.website_domain.replace(/^www\./, "");
  const contacts = parsed.data.contacts
    .filter((c) => grounded.has(c.source_url))                                  // cited by grounding, not invented
    .filter((c) => !/linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com/i.test(c.source_url))
    .map((c) => {
      const email = c.public_business_email?.toLowerCase() ?? null;
      const emailDomain = email?.split("@")[1] ?? "";
      return {
        source: "gemini" as const,
        name: c.name ?? null,
        role: c.role,
        source_url: c.source_url,
        source_title: c.source_title || grounded.get(c.source_url) || "Web source",
        // only a business address on the company's own domain is kept
        public_business_email: email && (emailDomain === companyDomain || emailDomain.endsWith(`.${companyDomain}`)) ? email : null,
        note: c.note ?? null,
      };
    });
  return { contacts, model: used, note: contacts.length ? "Verify this source yourself. AI can be wrong." : "No reliable contact found." };
}
