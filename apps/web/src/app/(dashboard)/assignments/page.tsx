import { requireAuth } from "@/lib/auth";
import { AssignmentsView } from "@/components/assignments/assignments-view";

export default async function AssignmentsPage() {
  const user = await requireAuth();
  return <AssignmentsView isManager={user.role === "manager"} />;
}
