import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getInternalSecret } from "@/lib/api-auth-server";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as Record<string, unknown>)
            );
          } catch {
            // ignore
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user profile for team_id
  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();

  if (!profile?.team_id) {
    return NextResponse.json(
      { error: "User not assigned to a team" },
      { status: 400 }
    );
  }

  const formData = await request.formData();
  const audioFile = formData.get("audio") as File | null;
  const customerName = formData.get("customerName") as string | null;
  const customerAddress = formData.get("customerAddress") as string | null;
  const durationSeconds = parseInt(
    (formData.get("durationSeconds") as string) ?? "0",
    10
  );
  const recordedAt =
    (formData.get("recordedAt") as string) ?? new Date().toISOString();

  if (!audioFile) {
    return NextResponse.json({ error: "Audio file required" }, { status: 400 });
  }

  // Upload to Supabase Storage
  const timestamp = Date.now();
  const storagePath = `${user.id}/${timestamp}_${audioFile.name}`;

  const { error: uploadError } = await supabase.storage
    .from("call-recordings")
    .upload(storagePath, audioFile, {
      contentType: audioFile.type,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  // Create call record
  const { data: call, error: insertError } = await supabase
    .from("calls")
    .insert({
      rep_id: user.id,
      team_id: profile.team_id,
      audio_storage_path: storagePath,
      duration_seconds: durationSeconds,
      status: "uploaded",
      customer_name: customerName,
      customer_address: customerAddress,
      recorded_at: recordedAt,
    })
    .select("id")
    .single();

  if (insertError || !call) {
    return NextResponse.json(
      { error: `Failed to create call: ${insertError?.message}` },
      { status: 500 }
    );
  }

  // Kick off processing pipeline (transcribe -> analyze)
  const origin = new URL(request.url).origin;

  // Fire and forget: transcribe, then analyze
  const internalHeaders = {
    "Content-Type": "application/json",
    "x-internal-secret": getInternalSecret(),
  };

  fetch(`${origin}/api/process/transcribe`, {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify({ callId: call.id }),
  })
    .then(async (res) => {
      if (res.ok) {
        await fetch(`${origin}/api/process/analyze`, {
          method: "POST",
          headers: internalHeaders,
          body: JSON.stringify({ callId: call.id }),
        });
      }
    })
    .catch(() => {
      // Processing errors are captured in the call record
    });

  return NextResponse.json({ callId: call.id, status: "uploaded" });
}
