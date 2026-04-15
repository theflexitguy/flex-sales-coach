import { requireAuth } from "@/lib/auth";
import { ObjectionLibrary } from "@/components/objections/objection-library";

export default async function ObjectionsPage() {
  await requireAuth();
  return <ObjectionLibrary />;
}
