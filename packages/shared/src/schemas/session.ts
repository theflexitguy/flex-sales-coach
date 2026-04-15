import { z } from "zod";

export const startSessionSchema = z.object({
  startedAt: z.string().datetime(),
});

export const uploadChunkSchema = z.object({
  sessionId: z.string().uuid(),
  chunkIndex: z.number().int().min(0),
  durationSeconds: z.number().int().min(0),
});

export const completeSessionSchema = z.object({
  sessionId: z.string().uuid(),
  label: z.string().min(1).max(200).trim(),
});

export type StartSessionInput = z.infer<typeof startSessionSchema>;
export type UploadChunkInput = z.infer<typeof uploadChunkSchema>;
export type CompleteSessionInput = z.infer<typeof completeSessionSchema>;
