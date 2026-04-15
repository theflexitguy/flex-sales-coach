import { requireManager } from "@/lib/auth";
import { SettingsPanel } from "@/components/settings/settings-panel";

export default async function SettingsPage() {
  const user = await requireManager();
  return <SettingsPanel user={user} />;
}
