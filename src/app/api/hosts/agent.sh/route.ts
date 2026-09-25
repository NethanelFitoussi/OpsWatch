import { agentScript } from '@/lib/hosts/agent-script';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * The agent, served by the operator's own OpsWatch.
 *
 * **Unauthenticated on purpose, and it carries no secret.** The script reads its host id and its key
 * from `/etc/opswatch/agent.conf`, which the install command writes with mode 600 — so what is served
 * here is the same bytes for everybody and discloses nothing. Requiring a session would mean an
 * operator could not fetch it from the machine they are installing on, which is the one place they
 * need it.
 *
 * Served as plain text with a filename, so `curl -o` gets a file an operator can read before running
 * it and `sha256sum` gives the digest the page shows.
 */
export function GET() {
  const script = agentScript({ baseUrl: env().OPSWATCH_PUBLIC_URL ?? '' });
  return new Response(script, {
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'content-disposition': 'inline; filename="opswatch-agent.sh"',
      'cache-control': 'no-store',
    },
  });
}
