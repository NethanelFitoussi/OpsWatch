/**
 * Repository evidence: the commit, the file and the lines a problem points at.
 *
 * Read-only, and never a claim of causation — a commit shown next to a problem is a correlation the reader judges.
 */
import { z } from 'zod';
import { epochSchema, idSchema } from './primitives';

export const commitSchema = z.object({
  sha: z.string(),
  message: z.string().optional(),
  author: z.string().optional(),
  at: epochSchema.optional(),
});
export type Commit = z.infer<typeof commitSchema>;

export const repositoryEvidenceSchema = z.object({
  id: idSchema,
  repository: z.string(),
  branch: z.string().optional(),
  commit: commitSchema,
  file: z.string().optional(),
  lines: z.object({ start: z.number().int(), end: z.number().int() }).optional(),
  snippet: z
    .object({ startLine: z.number().int(), code: z.array(z.string()), highlight: z.array(z.number().int()).default([]) })
    .optional(),
  /** Unified diff text, already trimmed by the server to the relevant hunks. */
  diff: z.string().optional(),
  summary: z.string().optional(),
});
export type RepositoryEvidence = z.infer<typeof repositoryEvidenceSchema>;
