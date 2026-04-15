import { z } from "zod";
import { TAG_COLORS } from "../constants";

export const createTagSchema = z.object({
  name: z.string().min(1).max(50).trim(),
  color: z.enum(TAG_COLORS),
});

export const applyTagSchema = z.object({
  callId: z.string().uuid(),
  tagId: z.string().uuid(),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type ApplyTagInput = z.infer<typeof applyTagSchema>;
