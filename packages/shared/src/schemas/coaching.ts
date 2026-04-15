import { z } from "zod";

export const createCoachingNoteSchema = z.object({
  callId: z.string().uuid(),
  content: z.string().min(1).max(5000).trim(),
  timestampMs: z.number().int().min(0).optional(),
});

export const updateCoachingNoteSchema = z.object({
  noteId: z.string().uuid(),
  content: z.string().min(1).max(5000).trim(),
});

export type CreateCoachingNoteInput = z.infer<typeof createCoachingNoteSchema>;
export type UpdateCoachingNoteInput = z.infer<typeof updateCoachingNoteSchema>;
