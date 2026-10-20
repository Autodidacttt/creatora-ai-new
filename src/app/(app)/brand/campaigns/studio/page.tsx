import { CampaignStudio } from "@/components/workspace/studio/campaign-studio";

export const metadata = { title: "Campaign Studio · Creatora AI" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const campaignId = id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  return <CampaignStudio campaignId={campaignId} />;
}
