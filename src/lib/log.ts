/** A structured, names-only log line about one connection. Never pass secrets or credential values. */
export type ConnectionEvent = {
  event: 'assume_role' | 'launch_stack' | 'template_download';
  connectionId: string;
  ok: boolean;
  errorCode?: string;
};

export function logConnectionEvent(event: ConnectionEvent): void {
  console.info(JSON.stringify(event));
}
