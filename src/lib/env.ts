import 'server-only';
import { z } from 'zod';

const schema = z.object({
  OPSWATCH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  OPSWATCH_DATA_DIR: z.string().min(1).default('/data'),
  /** `off` stops the collector in this process. §9.2's off switch. */
  OPSWATCH_COLLECTOR: z.enum(['on', 'off']).default('on'),
  /**
   * `collector` is a second container from the same image that collects and serves nothing; `web` is its
   * counterpart that serves pages and does not collect. Unset means one container doing both, which is what
   * an ordinary self-hosted installation runs.
   */
  OPSWATCH_ROLE: z.enum(['web', 'collector']).optional(),
  OPSWATCH_PUBLIC_URL: z.url().optional(),
  OPSWATCH_TEMPLATE_BUCKET: z.string().min(3).optional(),
  OPSWATCH_AWS_ENDPOINT_URL: z.url().optional(),
  OPSWATCH_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  OPSWATCH_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  OPSWATCH_GOOGLE_ALLOWED_DOMAIN: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new EnvError(`Invalid OpsWatch configuration: ${details}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= loadEnv(process.env);
  return cached;
}
