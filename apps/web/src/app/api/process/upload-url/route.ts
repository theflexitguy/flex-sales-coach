import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdmin } from "@flex/supabase/admin";
import { cookies } from "next/headers";

// Returns a Supabase signed upload URL so the browser can PUT the audio file
// directly to Storage without routing megabytes through a serverless function.
// After the upload completes the client calls /api/process/trigger to kick off
// the transcribe → analyze pipeline.

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
            // ignore in Server Components
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

  const body = await request.json();
  const { fileName, contentType, customerName, customerAddress, recordedAt } = body as {
    fileName: string;
    contentType: string;
    customerName?: string;
    customerAddress?: string;
    recordedAt?: string;
  };

  if (!fileName || !contentType) {
    return NextResponse.json(
      { error: "fileName and contentType required" },
      { status: 400 }
    );
  }

  // Normalise M4A content types — browsers report audio/x-m4a, audio/mp4, or
  // even video/mp4 depending on the platform. Supabase Storage and Deepgram
  // both accept audio/mp4 for M4A containers.
  const normalisedType = /m4a|x-m4a/.test(contentType) ? "audio/mp4" : contentType;

  const timestamp = Date.now();
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${user.id}/${timestamp}_${safeFileName}`;

  const admin = createAdmin();

  const { data: signed, error: signedError } = await admin.storage
    .from("call-recordings")
    .createSignedUploadUrl(storagePath, { upsert: false });

  if (signedError || !signed) {
    return NextResponse.json(
      { error: `Failed to create upload URL: ${signedError?.message}` },
      { status: 500 }
    );
  }

  // Create the call record now so the dashboard shows the pending upload immediately.
  const { data: call, error: insertError } = await supabase
    .from("calls")
    .insert({
      rep_id: user.id,
      team_id: profile.team_id,
      audio_storage_path: storagePath,
      duration_seconds: 0,
      status: "uploaded",
      customer_name: customerName || "Unknown Customer",
      customer_address: customerAddress ?? null,
      recorded_at: recordedAt ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !call) {
    return NextResponse.json(
      { error: `Failed to create call: ${insertError?.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    signedUrl: signed.signedUrl,
    token: signed.token,
    storagePath,
    callId: call.id,
    contentType: normalisedType,
  });
}
