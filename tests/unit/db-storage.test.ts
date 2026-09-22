import { describe, expect, it } from 'vitest';
import { describeStorage, storageWarning, type StorageDeps } from '@/lib/db/storage';

/**
 * The mount table of the container that actually lost the data, trimmed to what matters. `/data` is the
 * named volume; `/tmp` is not a mount at all, so it sits on the `overlay` root — the container's own writable
 * layer, which is discarded when the container is recreated.
 */
const CONTAINER_MOUNTS = [
  'overlay / overlay rw,relatime 0 0',
  '/dev/nvme0n1p2 /data ext4 rw,relatime,errors=remount-ro 0 0',
  'tmpfs /dev tmpfs rw,nosuid 0 0',
  'proc /proc proc rw,nosuid 0 0',
].join('\n');

const deps = (over: Partial<StorageDeps> = {}): StorageDeps => ({
  readMounts: () => CONTAINER_MOUNTS,
  isContainer: () => true,
  ...over,
});

describe('where the database actually lives', () => {
  it('sees a mounted volume as persistent', () => {
    const facts = describeStorage('/data', deps());
    expect(facts).toMatchObject({ dataDir: '/data', mountPoint: '/data', filesystem: 'ext4', persistent: true });
    expect(storageWarning('/data', deps())).toBeNull();
  });

  it('sees a subdirectory of a mounted volume as persistent too', () => {
    expect(describeStorage('/data/opswatch', deps()).persistent).toBe(true);
  });

  it('THE REGRESSION: /tmp inside a container is the disposable layer, not storage', () => {
    // This is the exact configuration that discarded the admin account and the encrypted credentials.
    const facts = describeStorage('/tmp/opswatch-data', deps());
    expect(facts).toMatchObject({ mountPoint: '/', filesystem: 'overlay', persistent: false });
    const warning = storageWarning('/tmp/opswatch-data', deps());
    expect(warning).toContain('/tmp/opswatch-data');
    expect(warning).toContain('NOT persistent');
  });

  it('treats tmpfs as disposable, because memory is not storage', () => {
    const mounts = `${CONTAINER_MOUNTS}\ntmpfs /scratch tmpfs rw 0 0`;
    expect(describeStorage('/scratch', deps({ readMounts: () => mounts })).persistent).toBe(false);
  });

  it('picks the closest mount when one is nested inside another', () => {
    const mounts = `${CONTAINER_MOUNTS}\ntmpfs /data/cache tmpfs rw 0 0`;
    expect(describeStorage('/data/cache/x', deps({ readMounts: () => mounts })).filesystem).toBe('tmpfs');
    expect(describeStorage('/data/keep', deps({ readMounts: () => mounts })).filesystem).toBe('ext4');
  });

  it('does not mistake a sibling directory for a mount point', () => {
    // `/database` must not match the `/data` mount by string prefix.
    const facts = describeStorage('/database', deps());
    expect(facts.mountPoint).toBe('/');
    expect(facts.persistent).toBe(false);
  });

  it('resolves a relative path before judging it', () => {
    expect(describeStorage('/data/../tmp/x', deps()).persistent).toBe(false);
  });

  it('understands the octal escaping /proc/self/mounts uses for a space', () => {
    const mounts = '/dev/sda1 /my\\040data ext4 rw 0 0';
    expect(describeStorage('/my data', deps({ readMounts: () => mounts }))).toMatchObject({
      mountPoint: '/my data',
      filesystem: 'ext4',
      persistent: true,
    });
  });
});

describe('what it refuses to claim', () => {
  it('says nothing outside a container: the operator owns the filesystem there', () => {
    expect(storageWarning('/tmp/opswatch-data', deps({ isContainer: () => false }))).toBeNull();
  });

  it('says nothing when there is no mount table to read, rather than guessing', () => {
    expect(storageWarning('/tmp/opswatch-data', deps({ readMounts: () => '' }))).toBeNull();
  });

  it('survives a mount table it cannot parse', () => {
    expect(() => describeStorage('/data', deps({ readMounts: () => 'garbage\n\nalso garbage' }))).not.toThrow();
  });

  it('names the directory but nothing else about the database', () => {
    const warning = storageWarning('/tmp/opswatch-data', deps()) ?? '';
    expect(warning).toContain('/tmp/opswatch-data');
    for (const secret of ['OPSWATCH_SECRET', 'password', 'sqlite', '.env']) {
      expect(warning).not.toContain(secret);
    }
  });
});
