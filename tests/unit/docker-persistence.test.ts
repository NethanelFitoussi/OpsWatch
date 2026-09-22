import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * The self-hosted installation's promise: `docker compose build && docker compose up -d` does not destroy the
 * admin account, the encrypted integration credentials, the settings or the collected history.
 *
 * It was broken once, and silently. `docker-compose.yml` passes `.env` through `env_file`; `.env` is also what
 * `npm run dev` reads; and an `OPSWATCH_DATA_DIR` meant for a local run therefore overrode the image's `/data`.
 * The container wrote its database into its own writable layer, the mounted volume stayed empty, and the next
 * rebuild threw everything away — after which OpsWatch correctly offered "Create admin" again, because as far
 * as the database was concerned there had never been one.
 *
 * These assertions are the shape of the fix. The end-to-end proof that a real container keeps its data across
 * a rebuild is `scripts/verify-persistence.sh`, which needs Docker and so runs on its own.
 */
const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

type Compose = {
  services: Record<string, { environment?: Record<string, string>; volumes?: string[]; env_file?: string | string[] }>;
  volumes?: Record<string, unknown>;
};

const compose = parse(read('docker-compose.yml')) as Compose;
const service = compose.services.opswatch;
const dockerfile = read('Dockerfile');

describe('the container writes its database to the mounted volume', () => {
  it('pins OPSWATCH_DATA_DIR in `environment`, which outranks `env_file`', () => {
    // The whole fix in one assertion: compose resolves `environment` after `env_file`, so a stray
    // OPSWATCH_DATA_DIR in .env can no longer redirect the database into the disposable layer.
    expect(service.environment?.OPSWATCH_DATA_DIR).toBe('/data');
  });

  it('still reads .env, because that is where the secret and the AWS identity live', () => {
    expect(service.env_file).toBeDefined();
  });

  it('mounts a named volume at exactly that path', () => {
    expect(service.volumes).toContain('opswatch-data:/data');
    expect(compose.volumes).toHaveProperty('opswatch-data');
  });

  it('agrees with the image default, so running the image without compose is right too', () => {
    expect(dockerfile).toMatch(/OPSWATCH_DATA_DIR=\/data/);
    expect(dockerfile).toMatch(/VOLUME \["\/data"\]/);
  });

  it('declares no other writable location for application state', () => {
    // A second volume would mean a second thing to back up, and one of them would be forgotten.
    expect(Object.keys(compose.volumes ?? {})).toEqual(['opswatch-data']);
  });
});

describe('the example configuration does not lead an operator into it', () => {
  const example = read('.env.example');

  it('shows the container path, and says it is the container path', () => {
    expect(example).toMatch(/OPSWATCH_DATA_DIR=\/data/);
  });

  it('warns that Docker ignores this value, so a local override cannot be mistaken for a global one', () => {
    expect(example.toLowerCase()).toContain('docker compose ignores');
  });
});

describe('the test harness is deliberately ephemeral, and says so', () => {
  const testCompose = parse(read('docker-compose.test.yml')) as Compose & {
    services: Record<string, { tmpfs?: string[] }>;
  };

  it('uses tmpfs so each e2e run starts from an empty database', () => {
    // Stated as a test because it is the reason the e2e suite could never have caught the bug above: it
    // never recreates a container against a real volume. `verify-persistence.sh` is what covers that.
    expect(testCompose.services.opswatch.tmpfs?.some((mount) => mount.startsWith('/data'))).toBe(true);
  });
});
