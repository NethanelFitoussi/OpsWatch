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

/** A failed monitoring call. Names and codes only: never parameters, resource names, query text or results. */
export type MonitoringEvent = {
  event: 'monitoring_call';
  connectionId: string;
  region: string;
  action: string;
  reason: 'denied' | 'throttled' | 'error';
  code: string;
};

export function logMonitoringFailure(event: MonitoringEvent): void {
  console.info(JSON.stringify(event));
}
