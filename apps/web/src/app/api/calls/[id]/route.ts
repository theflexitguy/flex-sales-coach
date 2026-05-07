import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { deleteCallForManager } from "@/lib/call-delete";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await deleteCallForManager(auth, id);
  return NextResponse.json(result.body, { status: result.status });
}
