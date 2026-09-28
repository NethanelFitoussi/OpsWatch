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
  const db = getDb();

  // The collector runs in the application process by default (§9.2). It claims a lock before doing anything,
  // so Next's double registration in development and a second container are both harmless.
  const { collectorEnabled, collectorOwner, startCollector } = await import('./lib/collector/runner');
  if (!collectorEnabled(process.env)) return;
  const { FRESH_INSTALL_JOBS } = await import('./lib/collector/jobs');
  const { listConnections } = await import('./lib/connections/repository');
  const { scopesOf } = await import('./lib/monitoring/shared/scopes');
  const { runJob } = await import('./lib/collector/run-job');
  startCollector({
    db,
    owner: collectorOwner(),
    now: () => Date.now(),
    // Re-read each tick, so a connection added while OpsWatch is running is collected without a restart.
    // `scopesOf` decides what a scope is per cloud — a region for AWS, a project for Google, the
    // account for DigitalOcean — rather than applying the AWS answer everywhere.
    environments: () =>
      listConnections(db).flatMap((connection) =>
        scopesOf(connection).map((scope) => ({ connectionId: connection.id, scope, provider: connection.provider })),
      ),
    enabled: () => FRESH_INSTALL_JOBS,
    run: runJob,
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as unknown as NodeJS.Timeout),
    log: (line) => console.warn(line),
  });
}
