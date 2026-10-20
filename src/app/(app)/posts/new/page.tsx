import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { PostForm } from "@/components/posts/post-form";

export const metadata: Metadata = { title: "Add portfolio piece" };

export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  await requireSession({ roles: ["creator"] });
  const { welcome } = await searchParams;
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">{welcome ? "Last step" : "Portfolio"}</p>
        <h1 className="display text-3xl sm:text-4xl">{welcome ? "Add your first piece" : "Add a portfolio piece"}</h1>
        <p className="mt-1 text-sm text-ink-2">Brands filter by tools, format and style — the more you document, the easier you are to find.</p>
      </div>
      <PostForm />
    </div>
  );
}
