import { requireManager } from "@/lib/auth";
import { HelpRequestQueue } from "@/components/help-requests/help-request-queue";

export default async function HelpRequestsPage() {
  await requireManager();
  return <HelpRequestQueue />;
}
