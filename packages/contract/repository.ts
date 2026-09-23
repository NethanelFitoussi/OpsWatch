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
  /**
   * A link to this commit in the provider, built by the server because only the server knows the provider,
   * the host, and whether the instance talks to github.com or an enterprise host. Absent means OpsWatch
   * cannot build a link for that provider — a fact, not a failure.
   */
  url: z.string().optional(),
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
  /** The same, for the file and its line range. Built by the server, for the same reason. */
  fileUrl: z.string().optional(),
});
export type RepositoryEvidence = z.infer<typeof repositoryEvidenceSchema>;

/**
 * What OpsWatch knows about the repositories it can read, without any credential in it.
 *
 * A client needs three things before it offers a "see the code" affordance: whether a connection exists,
 * whether it has been verified, and which repositories are recorded. A token is none of those and is never
 * part of this shape.
 */
export const repositorySummarySchema = z.object({
  id: idSchema,
  /** `owner/name`, as every other surface names a repository. */
  fullName: z.string(),
  defaultBranch: z.string(),
});
export type RepositorySummary = z.infer<typeof repositorySummarySchema>;

export const REPOSITORY_CONNECTION_STATES = ['connected', 'unverified', 'failed', 'not_connected'] as const;

export const repositoryStateSchema = z.object({
  /** `connected` only when a token has been verified. A stored token is `unverified`, which is not the same. */
  state: z.enum(REPOSITORY_CONNECTION_STATES),
  /** The account the token belongs to. Not a secret, and it is how a reader recognises the connection. */
  account: z.string().optional(),
  repositories: z.array(repositorySummarySchema).default([]),
});
export type RepositoryState = z.infer<typeof repositoryStateSchema>;
