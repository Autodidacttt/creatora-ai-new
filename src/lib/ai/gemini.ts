import "server-only";
import { GoogleGenAI } from "@google/genai";

export { GEMINI_FALLBACK_MODELS, GEMINI_MODEL, withModelFallback } from "./models";

let client: GoogleGenAI | null | undefined;

/** Server-only Gemini client. Returns null when no key is configured (feature degrades gracefully). */
export function getGemini(): GoogleGenAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  return client;
}
