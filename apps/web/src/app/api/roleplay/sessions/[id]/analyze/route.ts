import { NextResponse } from "next/server";
import { isInternalCall } from "@/lib/api-auth-server";
import { analyzeRoleplaySession } from "@/lib/roleplay-analysis";

export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Allow both internal calls and authenticated users
  const isInternal = isInternalCall(request);
  if (!isInternal) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await analyzeRoleplaySession(id);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Roleplay analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
