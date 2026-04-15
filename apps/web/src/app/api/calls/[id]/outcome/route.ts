import { NextResponse } from "next/server";
import { createServer } from "@/lib/supabase-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServer();
  const { outcome, outcomeNotes } = await request.json();

  if (!outcome) {
    return NextResponse.json({ error: "outcome required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("calls")
    .update({ outcome, outcome_notes: outcomeNotes ?? null })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
