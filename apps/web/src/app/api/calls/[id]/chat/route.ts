import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth-server";
import { createAdmin } from "@flex/supabase/admin";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const admin = createAdmin();

  const { data: messages } = await admin
    .from("call_chat_messages")
    .select("*")
    .eq("call_id", id)
    .order("created_at");

  return NextResponse.json({
    messages: (messages ?? []).map((m: Record<string, unknown>) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { user } = auth;
  const admin = createAdmin();

  const { message } = await request.json();
  if (!message) return NextResponse.json({ error: "Message required" }, { status: 400 });

  // Get transcript and analysis for context
  const [{ data: transcript }, { data: analysis }, { data: call }] = await Promise.all([
    admin.from("transcripts").select("full_text").eq("call_id", id).single(),
    admin.from("call_analyses").select("summary, strengths, improvements").eq("call_id", id).single(),
    admin.from("calls").select("customer_name").eq("id", id).single(),
  ]);

  // Get chat history
  const { data: history } = await admin
    .from("call_chat_messages")
    .select("role, content")
    .eq("call_id", id)
    .order("created_at")
    .limit(20);

  // Save user message
  await admin.from("call_chat_messages").insert({
    call_id: id,
    user_id: user.id,
    role: "user",
    content: message,
  });

  // Build context
  const systemPrompt = `You are an expert door-to-door sales coach for a pest control company. You are helping analyze and coach on a specific sales call.

Call: ${call?.customer_name ?? "Unknown customer"}
${analysis ? `AI Summary: ${analysis.summary}\nStrengths: ${(analysis.strengths as string[]).join(", ")}\nAreas to improve: ${(analysis.improvements as string[]).join(", ")}` : ""}

Transcript:
${transcript?.full_text?.slice(0, 4000) ?? "No transcript available"}

Answer the user's question about this call. Be specific, reference actual things said in the conversation, and provide actionable coaching advice. Keep responses concise and practical.`;

  const chatMessages = [
    ...(history ?? []).map((h: { role: string; content: string }) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user" as const, content: message },
  ];

  // Haiku for conversational coaching chat — fast and cheap
  const result = streamText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: systemPrompt,
    messages: chatMessages,
    maxOutputTokens: 1024,
    async onFinish({ text }) {
      await admin.from("call_chat_messages").insert({
        call_id: id,
        user_id: user.id,
        role: "assistant",
        content: text,
      });
    },
  });

  return result.toTextStreamResponse();
}
