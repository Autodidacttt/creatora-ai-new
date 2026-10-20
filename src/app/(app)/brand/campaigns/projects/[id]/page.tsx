import { ProjectView } from "@/components/workspace/project-view";

export const metadata = { title: "Project · Creatora AI" };

export default async function BrandProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectView id={id} />;
}
