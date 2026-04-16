import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { randomUUID } from "crypto";
import { notifyCoachingMention } from "@/lib/notifications";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: callId } = await params;
  const admin = createAdmin();
  const formData = await request.formData();

  const content = (formData.get("content") as string) ?? "";
  const timestampMs = formData.get("timestampMs")
    ? parseInt(formData.get("timestampMs") as string, 10)
    : null;
  const audioFile = formData.get("audio") as File | null;
  const mentionIds = formData.get("mentionIds") as string | null; // comma-separated user IDs or "everyone"

  if (!content.trim() && !audioFile) {
    return NextResponse.json({ error: "Content or audio required" }, { status: 400 });
  }

  let audioUrl: string | null = null;
  let audioDurationSeconds: number | null = null;

  if (audioFile) {
    const storagePath = `${auth.user.id}/${randomUUID()}.webm`;
    const buffer = Buffer.from(await audioFile.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("audio-notes")
      .upload(storagePath, buffer, {
        contentType: audioFile.type || "audio/webm",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    const { data: signedData } = await admin.storage
      .from("audio-notes")
      .createSignedUrl(storagePath, 365 * 24 * 3600);

    audioUrl = signedData?.signedUrl ?? null;
    audioDurationSeconds = formData.get("audioDuration")
      ? parseInt(formData.get("audioDuration") as string, 10)
      : null;
  }

  const { data: note, error } = await admin.from("coaching_notes").insert({
    call_id: callId,
    author_id: auth.user.id,
    content: content.trim() || (audioFile ? "Audio note" : ""),
    timestamp_ms: timestampMs,
    audio_url: audioUrl,
    audio_duration_seconds: audioDurationSeconds,
  }).select("id").single();

  if (error || !note) {
    return NextResponse.json({ error: "Failed to save note" }, { status: 500 });
  }

  // Process @mentions if present
  if (mentionIds) {
    const { data: call } = await admin.from("calls").select("customer_name, team_id").eq("id", callId).single();
    const customerName = call?.customer_name ?? "Unknown";
    const authorName = auth.profile?.full_name ?? "Your manager";

    let targetUserIds: string[];

    if (mentionIds === "everyone") {
      // @everyone — get all active team members
      const { data: teamMembers } = await admin
        .from("profiles")
        .select("id")
        .eq("team_id", call?.team_id)
        .eq("is_active", true)
        .neq("id", auth.user.id);
      targetUserIds = (teamMembers ?? []).map((m) => m.id);

      // Create mention record with null user_id = @everyone
      await admin.from("coaching_note_mentions").insert({ note_id: note.id, user_id: null });
    } else {
      targetUserIds = mentionIds.split(",").filter((id) => id && id !== auth.user.id);

      // Create mention records
      if (targetUserIds.length > 0) {
        await admin.from("coaching_note_mentions").insert(
          targetUserIds.map((uid) => ({ note_id: note.id, user_id: uid }))
        );
      }
    }

    // Auto-share the call with mentioned users so they can see it
    if (targetUserIds.length > 0) {
      const shares = targetUserIds.map((uid) => ({
        call_id: callId,
        user_id: uid,
        shared_by: auth.user.id,
      }));
      await admin.from("call_shares").upsert(shares, { onConflict: "call_id,user_id" });

      // Notify each mentioned user
      await Promise.all(
        targetUserIds.map((uid) => notifyCoachingMention(uid, authorName, customerName, callId, note.id))
      );
    }
  }

  return NextResponse.json({ success: true, id: note.id });
}
