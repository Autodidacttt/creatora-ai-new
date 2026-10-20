import type { Lookups } from "@/types/app";
import { type DB, unwrap } from "./_db";

/** All filter / form vocabularies, loaded from the lookup tables. */
export async function getLookups(db: DB): Promise<Lookups> {
  const [skills, tools, categories, contentTypes, styles, platforms, languages] = await Promise.all([
    db.from("skills").select("id, name, slug").order("sort"),
    db.from("ai_tools").select("id, name, slug, category").order("sort"),
    db.from("categories").select("id, name, slug").order("sort"),
    db.from("content_types").select("id, name, slug").order("sort"),
    db.from("styles").select("id, name, slug").order("sort"),
    db.from("platforms").select("id, name, slug").order("sort"),
    db.from("languages").select("id, name, slug").order("sort"),
  ]);
  return {
    skills: unwrap(skills),
    ai_tools: unwrap(tools),
    categories: unwrap(categories),
    content_types: unwrap(contentTypes),
    styles: unwrap(styles),
    platforms: unwrap(platforms),
    languages: unwrap(languages),
  };
}
