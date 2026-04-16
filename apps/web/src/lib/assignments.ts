import { createAdmin } from "@flex/supabase/admin";

/**
 * Get the rep IDs visible to a manager.
 * Returns assigned reps + unassigned reps (reps with zero assignments on the team).
 * If the manager has no assignments at all, returns ALL reps on the team (backward compat).
 */
export async function getVisibleRepIds(managerId: string, teamId: string): Promise<string[]> {
  const admin = createAdmin();

  const [{ data: assignments }, { data: allReps }] = await Promise.all([
    admin
      .from("manager_rep_assignments")
      .select("rep_id, manager_id")
      .eq("team_id", teamId),
    admin
      .from("profiles")
      .select("id")
      .eq("team_id", teamId)
      .eq("role", "rep")
      .eq("is_active", true),
  ]);

  // Include manager's own ID so they can see their own data (e.g., help requests they submitted)
  const allRepIds = (allReps ?? []).map((r) => r.id);
  if (!allRepIds.includes(managerId)) allRepIds.push(managerId);

  // If no assignments exist on this team at all, show everything (backward compat)
  if (!assignments || assignments.length === 0) {
    return allRepIds;
  }

  // Reps assigned to this manager
  const assignedToMe = new Set(
    assignments.filter((a) => a.manager_id === managerId).map((a) => a.rep_id)
  );

  // Reps with ANY assignment (to any manager)
  const assignedToAnyone = new Set(assignments.map((a) => a.rep_id));

  // Unassigned reps = reps not assigned to anyone
  const unassigned = allRepIds.filter((id) => !assignedToAnyone.has(id));

  return [...assignedToMe, ...unassigned];
}
