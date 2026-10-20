import { requireSession } from "@/lib/auth";
import { ProjectView } from "@/components/workspace/project-view";

export const metadata = { title: "Project · Creatora AI" };

export default async function CreatorProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ roles: ["creator", "admin"] });
  const { id } = await params;
  return <ProjectView id={id} />;
}
