import { requireManager } from "@/lib/auth";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { isPlatformAdminEmail } from "@/lib/platform-admin";

export default async function SettingsPage() {
  const user = await requireManager();
  return <SettingsPanel user={user} isPlatformAdmin={isPlatformAdminEmail(user.email)} />;
}
