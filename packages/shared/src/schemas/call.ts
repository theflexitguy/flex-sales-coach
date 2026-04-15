import { z } from "zod";
import {
  CALL_STATUSES,
  MAX_AUDIO_DURATION_SECONDS,
  SUPPORTED_AUDIO_FORMATS,
} from "../constants";

export const createCallSchema = z.object({
  customerName: z.string().min(1).max(200).optional(),
  customerAddress: z.string().min(1).max(500).optional(),
  durationSeconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_AUDIO_DURATION_SECONDS),
  recordedAt: z.string().datetime(),
  audioContentType: z.enum(SUPPORTED_AUDIO_FORMATS),
});

export const updateCallStatusSchema = z.object({
  callId: z.string().uuid(),
  status: z.enum(CALL_STATUSES),
  errorMessage: z.string().max(1000).optional(),
});

export type CreateCallInput = z.infer<typeof createCallSchema>;
export type UpdateCallStatusInput = z.infer<typeof updateCallStatusSchema>;
