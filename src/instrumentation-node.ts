// Node-only body of instrumentation.ts, isolated into its own module so that Next's static
// analysis of the Edge bundle for instrumentation.ts never sees the `process.exit` call (see
// https://nextjs.org/docs/app/guides/instrumentation#importing-runtime-specific-code). It must
// only ever be imported from within the `NEXT_RUNTIME === 'nodejs'` branch of `register()`.
export async function registerNode() {
  const { loadEnv, EnvError } = await import('./lib/env');
  let env;
  try {
    env = loadEnv(process.env);
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(`[opswatch] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  const { baseCredentialsWarning } = await import('./lib/aws/base-credentials');
  const { googleSignInWarning } = await import('./lib/auth/google');
  const { storageWarning } = await import('./lib/db/storage');
  for (const warning of [
    baseCredentialsWarning(process.env),
    googleSignInWarning(env),
    // Said before the database is opened, so an operator whose data is about to be thrown away hears it
    // on the startup that would have discarded it rather than on the one that already did.
    storageWarning(env.OPSWATCH_DATA_DIR),
  ]) {
    if (warning) {
      console.warn(`[opswatch] ${warning}`);
    }
  }
  const { getDb } = await import('./lib/db/client');
  getDb();
}
