import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Where OpsWatch's database actually lives, and whether that place survives a restart.
 *
 * This exists because of a real failure: `docker-compose.yml` passes `.env` through `env_file`, and `.env` is
 * also what `npm run dev` reads. An `OPSWATCH_DATA_DIR` set for a local run therefore overrode the image's
 * `/data`, so the container wrote its database into its own writable layer while the mounted volume sat empty.
 * Everything — the admin account, the encrypted credentials, the settings — was silently discarded on the next
 * `docker compose up --build`, and nothing said so.
 *
 * The compose file now pins the directory so that cannot happen again. This is the second line of defence: a
 * self-hosted operator running OpsWatch some other way gets told, at startup, that their data is on disposable
 * storage — before they lose it rather than after.
 */

/** Filesystems whose contents do not outlive the container: the image's own layer, and memory. */
const DISPOSABLE_FILESYSTEMS = new Set(['overlay', 'overlayfs', 'aufs', 'tmpfs', 'ramfs']);

export type StorageFacts = {
  /** The resolved directory the database lives in. */
  dataDir: string;
  inContainer: boolean;
  /** The mount point `dataDir` sits on, and that mount's filesystem. */
  mountPoint: string;
  filesystem: string;
  /** False when the data directory is on the container's writable layer or in memory. */
  persistent: boolean;
};

export type StorageDeps = {
  /** The contents of `/proc/self/mounts`, or an empty string where there is no such file. */
  readMounts: () => string;
  isContainer: () => boolean;
};

const DEFAULT_DEPS: StorageDeps = {
  readMounts: () => {
    try {
      return fs.readFileSync('/proc/self/mounts', 'utf8');
    } catch {
      // Not Linux, or the file is unreadable. Nothing can be concluded, and nothing is claimed.
      return '';
    }
  },
  isContainer: () => fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv'),
};

/** `/proc/self/mounts` escapes spaces and a few other characters in octal. */
const unescapeMount = (value: string) => value.replace(/\\(\d{3})/g, (_, code: string) => String.fromCharCode(parseInt(code, 8)));

type Mount = { point: string; filesystem: string };

function parseMounts(contents: string): Mount[] {
  return contents
    .split('\n')
    .map((line) => line.split(' '))
    .filter((fields) => fields.length >= 3)
    .map((fields) => ({ point: unescapeMount(fields[1]), filesystem: fields[2] }));
}

/** The mount a path sits on is the longest mount point that contains it. */
function mountFor(target: string, mounts: readonly Mount[]): Mount | null {
  const candidates = mounts.filter((mount) => target === mount.point || target.startsWith(mount.point === '/' ? '/' : `${mount.point}/`));
  return candidates.reduce<Mount | null>((best, mount) => (best === null || mount.point.length > best.point.length ? mount : best), null);
}

export function describeStorage(dataDir: string, deps: StorageDeps = DEFAULT_DEPS): StorageFacts {
  const resolved = path.resolve(dataDir);
  const mount = mountFor(resolved, parseMounts(deps.readMounts()));
  const inContainer = deps.isContainer();
  return {
    dataDir: resolved,
    inContainer,
    mountPoint: mount?.point ?? '',
    filesystem: mount?.filesystem ?? '',
    // Outside a container the operator owns the filesystem and we say nothing. With no mount table there is
    // nothing to judge, so it is treated as persistent rather than warned about on a guess.
    persistent: !inContainer || mount === null || !DISPOSABLE_FILESYSTEMS.has(mount.filesystem),
  };
}

/**
 * One line, at startup, when the database is somewhere a restart will erase. Null when it is fine.
 *
 * The path is included because that is the whole point — an operator has to be able to see *where* it went —
 * and a directory path is not a secret. Nothing else about the database is named.
 */
export function storageWarning(dataDir: string, deps: StorageDeps = DEFAULT_DEPS): string | null {
  const facts = describeStorage(dataDir, deps);
  if (facts.persistent) return null;
  return (
    `OPSWATCH_DATA_DIR is ${facts.dataDir}, which is on this container's ${facts.filesystem} filesystem and is ` +
    'NOT persistent: the admin account, encrypted credentials and all collected data will be lost when the ' +
    'container is recreated. Point it at a mounted volume (the image defaults to /data).'
  );
}
