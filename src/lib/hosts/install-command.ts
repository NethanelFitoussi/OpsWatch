import { HOST_REPORT_INTERVAL_SECONDS } from '@opswatch/contract';

/**
 * The one command an operator runs, built where it is shown.
 *
 * Client-safe on purpose: the page that renders it is the page that has just been handed the key, and
 * passing a *function* across the server/client boundary is not something React allows — a mistake the
 * browser caught immediately and no type would have.
 *
 * It downloads from **their own** OpsWatch, prints the checksum to compare with the page, writes the
 * config with mode 600 and installs a cron entry. Nothing here pipes an unauthenticated internet script
 * into a root shell: the file is saved, its digest is printable, and the operator runs it when they are
 * satisfied with what they have read.
 */
export function installCommand(input: { baseUrl: string; hostId: string; secret: string }): string {
  const base = input.baseUrl.replace(/\/$/, '');
  return [
    `sudo mkdir -p /etc/opswatch && \\`,
    `curl -fsS ${base}/api/hosts/agent.sh -o /tmp/opswatch-agent.sh && \\`,
    `sha256sum /tmp/opswatch-agent.sh && \\`,
    `sudo install -m 755 /tmp/opswatch-agent.sh /usr/local/bin/opswatch-agent && \\`,
    // Broken across lines on purpose: the key makes this the longest line by far, and a command whose
    // most important line runs off the edge of the box is one somebody copies wrong.
    `printf 'OPSWATCH_HOST_ID=%s\\nOPSWATCH_HOST_SECRET=%s\\n' \\`,
    `  '${input.hostId}' \\`,
    `  '${input.secret}' \\`,
    `  | sudo tee /etc/opswatch/agent.conf >/dev/null && \\`,
    `sudo chmod 600 /etc/opswatch/agent.conf && \\`,
    `echo '*/${Math.round(HOST_REPORT_INTERVAL_SECONDS / 60)} * * * * root /usr/local/bin/opswatch-agent >/dev/null 2>&1' | sudo tee /etc/cron.d/opswatch-agent >/dev/null && \\`,
    `sudo /usr/local/bin/opswatch-agent`,
  ].join('\n');
}
