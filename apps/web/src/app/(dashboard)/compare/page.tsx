import { requireManager } from "@/lib/auth";
import { CompareView } from "@/components/compare/compare-view";

export default async function ComparePage() {
  await requireManager();
  return <CompareView />;
}
