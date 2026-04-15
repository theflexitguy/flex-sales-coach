import { requireAuth } from "@/lib/auth";
import { createServer } from "@/lib/supabase-server";
import { CallsListEnhanced } from "@/components/calls/calls-list-enhanced";
import { UploadCall } from "@/components/calls/upload-call";

export default async function CallsPage() {
  const user = await requireAuth();
  const supabase = await createServer();
  const isManager = user.role === "manager";

  let reps: Array<{ id: string; name: string }> = [];
  if (isManager) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "rep")
      .eq("is_active", true)
      .order("full_name");
    reps = (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Conversations</h1>
          <p className="text-zinc-400 mt-1">
            {isManager ? "All team conversations" : "Your conversations"}
          </p>
        </div>
        <UploadCall />
      </div>
      <CallsListEnhanced reps={reps} isManager={isManager} />
    </div>
  );
}
