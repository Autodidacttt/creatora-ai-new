import { redirect } from "next/navigation";

// The Campaigns landing (/campaigns) is the brand dashboard.
export default function BrandCampaignsIndex() {
  redirect("/campaigns");
}
