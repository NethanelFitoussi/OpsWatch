import { z } from 'zod';

const schema = z.object({
  OPSWATCH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  OPSWATCH_DATA_DIR: z.string().min(1).default('/data'),
  OPSWATCH_PUBLIC_URL: z.string().url().optional(),
  OPSWATCH_TEMPLATE_BUCKET: z.string().min(3).optional(),
  OPSWATCH_AWS_ENDPOINT_URL: z.string().url().optional(),
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
