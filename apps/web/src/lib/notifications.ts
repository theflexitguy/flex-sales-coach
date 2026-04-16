import { createAdmin } from "@flex/supabase/admin";

type NotificationType =
  | "help_request_new"
  | "help_request_response"
  | "call_analyzed"
  | "coaching_note"
  | "coaching_note_mention"
  | "call_shared"
  | "session_complete"
  | "badge_earned";

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body?: string,
  data?: Record<string, unknown>
) {
  const admin = createAdmin();
  await admin.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body: body ?? null,
    data: data ?? {},
  });
}

export async function notifyCallAnalyzed(callId: string, repId: string, score: number, customerName: string) {
  await createNotification(
    repId,
    "call_analyzed",
    `Call analyzed: ${customerName}`,
    `Your call scored ${score}/100`,
    { callId }
  );
}

export async function notifyHelpRequestNew(managerId: string, repName: string, callName: string, requestId: string) {
  await createNotification(
    managerId,
    "help_request_new",
    `${repName} needs help`,
    `On call with ${callName}`,
    { requestId }
  );
}

export async function notifyHelpRequestResponse(repId: string, managerName: string, requestId: string) {
  await createNotification(
    repId,
    "help_request_response",
    `${managerName} responded`,
    "Check your coaching feed",
    { requestId }
  );
}

export async function notifyCoachingNote(repId: string, managerName: string, callId: string, customerName: string) {
  await createNotification(
    repId,
    "coaching_note",
    `New coaching note from ${managerName}`,
    `On your call with ${customerName}`,
    { callId }
  );
}

export async function notifySessionComplete(repId: string, conversationCount: number, sessionLabel: string) {
  await createNotification(
    repId,
    "session_complete",
    "Recording processed",
    `${conversationCount} conversation${conversationCount !== 1 ? "s" : ""} from "${sessionLabel}"`,
    {}
  );
}

export async function notifyCallShared(userId: string, sharedByName: string, customerName: string, callId: string) {
  await createNotification(
    userId,
    "call_shared",
    `${sharedByName} shared a conversation`,
    `Call with ${customerName}`,
    { callId }
  );
}

export async function notifyCoachingMention(userId: string, authorName: string, customerName: string, callId: string, noteId: string) {
  await createNotification(
    userId,
    "coaching_note_mention",
    `${authorName} mentioned you`,
    `Coaching note on call with ${customerName}`,
    { callId, noteId }
  );
}
