/**
 * The names a federation attempt can fail by.
 *
 * Separated from the module that produces them so a type can be imported by client code and by the
 * schema without dragging `server-only` along with it.
 */
export type FederationFailure =
  | 'invalid_target'
  | 'no_key'
  | 'no_public_url'
  | 'exchange_refused'
  | 'impersonation_refused'
  | 'unreachable';
