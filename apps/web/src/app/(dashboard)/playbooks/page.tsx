import { requireManager } from "@/lib/auth";
import { PlaybooksView } from "@/components/playbooks/playbooks-view";

export default async function PlaybooksPage() {
  await requireManager();
  return <PlaybooksView />;
}
