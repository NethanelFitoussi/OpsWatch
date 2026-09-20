/**
 * The AI assistant, and the search that shares its result shape.
 *
 * An answer always carries its citations: a client shows what the answer was built from, so the reader can check it
 * rather than believe it.
 */
import { z } from 'zod';
import { epochSchema, idSchema, refSchema, refTypeSchema, severitySchema } from './primitives';

export const aiAnswerSchema = z.object({
  id: idSchema,
  answer: z.string(),
  generatedAt: epochSchema,
  citations: z.array(refSchema).default([]),
  model: z.string().optional(),
});
export type AiAnswer = z.infer<typeof aiAnswerSchema>;

export const searchResultSchema = z.object({
  type: refTypeSchema,
  id: idSchema,
  title: z.string(),
  subtitle: z.string().optional(),
  severity: severitySchema.optional(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({ items: z.array(searchResultSchema) });
export type SearchResponse = z.infer<typeof searchResponseSchema>;
