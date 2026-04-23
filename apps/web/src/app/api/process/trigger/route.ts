import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Kicks off the transcribe → analyze pipeline for a call whose audio is already
// in Supabase Storage. Called by the browser after a direct signed-URL upload.

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

  const { callId } = await request.json() as { callId?: string };

  if (!callId) {
    return NextResponse.json({ error: "callId required" }, { status: 400 });
  }

  // Verify the caller owns this call before triggering processing.
  const { data: call } = await supabase
    .from("calls")
    .select("id, rep_id")
    .eq("id", callId)
    .single();

  if (!call || call.rep_id !== user.id) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  const origin = new URL(request.url).origin;
  const internalHeaders = {
    "Content-Type": "application/json",
    "x-internal-secret": process.env.INTERNAL_API_SECRET || "flex-internal-2024",
  };

  fetch(`${origin}/api/process/transcribe`, {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify({ callId }),
  })
    .then(async (res) => {
      if (res.ok) {
        await fetch(`${origin}/api/process/analyze`, {
          method: "POST",
          headers: internalHeaders,
          body: JSON.stringify({ callId }),
        });
      }
    })
    .catch(() => {});

  return NextResponse.json({ callId, status: "processing" });
}
