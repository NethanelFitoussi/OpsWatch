import { defineConfig } from '@playwright/test';

/**
 * Drives only the admin-creation form for `scripts/verify-persistence.sh`. It has no global setup and no
 * server of its own: the script owns the container, and this just fills in the real form once, so the admin
 * whose survival is being checked was created the way an operator creates one.
 */
export default defineConfig({
  testDir: '.',
  reporter: 'line',
  use: { baseURL: `http://127.0.0.1:${process.env.PERSISTENCE_PORT ?? 3200}` },
});
