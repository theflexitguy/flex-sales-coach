import { requireAuth } from "@/lib/auth";
import { ManagerDashboard } from "@/components/dashboard/manager-dashboard";
import { ActiveSessions } from "@/components/dashboard/active-sessions";

export default async function DashboardPage() {
  const user = await requireAuth();
  const isManager = user.role === "manager";

  if (isManager) {
    return <ManagerDashboard userName={user.fullName.split(" ")[0]} />;
  }

  // Rep view — simple stats (mobile app is primary for reps)
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">My Dashboard</h1>
        <p className="text-zinc-400 mt-1">Welcome back, {user.fullName.split(" ")[0]}</p>
      </div>
      <ActiveSessions />
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-12 text-center">
        <p className="text-zinc-400">Use the mobile app to record calls and view your stats</p>
      </div>
    </div>
  );
}
