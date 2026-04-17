import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { createAdmin } from "@flex/supabase/admin";

interface LocationPoint {
  elapsedS: number;
  latitude: number;
  longitude: number;
  capturedAt?: string;
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId, points } = (await request.json()) as {
    sessionId: string;
    points: LocationPoint[];
  };

  if (!sessionId || !Array.isArray(points) || points.length === 0) {
    return NextResponse.json({ error: "sessionId and points[] required" }, { status: 400 });
  }

  const admin = createAdmin();

  // Verify session belongs to this user
  const { data: session } = await admin
    .from("recording_sessions")
    .select("id, rep_id")
    .eq("id", sessionId)
    .single();

  if (!session || session.rep_id !== auth.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const rows = points
    .filter((p) => typeof p.latitude === "number" && typeof p.longitude === "number")
    .map((p) => ({
      session_id: sessionId,
      elapsed_s: Math.max(0, Math.round(p.elapsedS ?? 0)),
      latitude: p.latitude,
      longitude: p.longitude,
      captured_at: p.capturedAt ?? new Date().toISOString(),
    }));

  if (rows.length === 0) {
    return NextResponse.json({ success: true, inserted: 0 });
  }

  await admin.from("session_location_points").insert(rows);

  return NextResponse.json({ success: true, inserted: rows.length });
}
