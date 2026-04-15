import { requireManager } from "@/lib/auth";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";

export default async function AnalyticsPage() {
  await requireManager();

  return <AnalyticsDashboard />;
}
