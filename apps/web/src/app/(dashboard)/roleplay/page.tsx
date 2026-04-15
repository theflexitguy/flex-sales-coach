import { requireManager } from "@/lib/auth";
import { RoleplayDashboard } from "@/components/roleplay/roleplay-dashboard";
import { ScenarioManager } from "@/components/roleplay/scenario-manager";

export default async function RoleplayPage() {
  await requireManager();

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Roleplay Training</h1>
        <p className="text-zinc-400 mt-1">
          AI voice practice for your reps, built from real call data
        </p>
      </div>

      <RoleplayDashboard />
      <ScenarioManager />
    </div>
  );
}
