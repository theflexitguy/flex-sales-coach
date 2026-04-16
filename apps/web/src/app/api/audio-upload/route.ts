import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { randomUUID } from "crypto";

export async function POST(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const audioFile = formData.get("audio") as File | null;
  if (!audioFile) return NextResponse.json({ error: "No audio file" }, { status: 400 });

  const admin = createAdmin();
  const ext = audioFile.type?.includes("mp4") ? "m4a" : "webm";
  const storagePath = `${auth.user.id}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await audioFile.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("audio-notes")
    .upload(storagePath, buffer, {
      contentType: audioFile.type || "audio/mp4",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
  }

  const { data: signedData } = await admin.storage
    .from("audio-notes")
    .createSignedUrl(storagePath, 365 * 24 * 3600);

  return NextResponse.json({ audioUrl: signedData?.signedUrl ?? null });
}
