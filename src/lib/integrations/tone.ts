import type { ConnectionTone } from '@/components/connections/connection-card';
import type { ConnectionStatus } from '@/lib/connections/types';
import type { IntegrationState } from './catalogue';

/**
 * The colour of a connection's state pill, in one place so the three screens that show connections cannot
 * disagree about what "degraded" looks like.
 *
 * `neutral` is deliberately not a warning colour: an integration nobody has set up is not broken, and
 * painting it amber would make a first run look like an incident.
 */
export const INTEGRATION_TONES: Record<IntegrationState, ConnectionTone> = {
  connected: 'success',
  degraded: 'warning',
  not_configured: 'neutral',
  unavailable: 'neutral',
};

/** An AWS connection carries its own vocabulary — the result of its last permission test. */
export const CONNECTION_TONES: Record<ConnectionStatus, ConnectionTone> = {
  draft: 'neutral',
  pending: 'info',
  ok: 'success',
  degraded: 'warning',
  failed: 'danger',
};
