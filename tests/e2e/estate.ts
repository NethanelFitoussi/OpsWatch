/**
 * The estate a sweep walks.
 *
 * Shared so the accessibility sweep and the narrow-layout sweep cover the same product rather than two
 * drifting samples of it: a page added to one and forgotten in the other is how a section ends up
 * audited for contrast and never looked at on a phone.
 *
 * Every section's landing page, the detail pages an operator reaches from them, the settings a new
 * installation starts in, and the documentation. A pass over four pages would be a claim, not an audit.
 */
export function estateRoutes(connectionId: string, region: string): string[] {
  const base = `/c/${connectionId}/${region}`;
  return [
    `${base}/overview/health`,
    `${base}/overview/problems`,
    `${base}/overview/insights`,
    `${base}/overview/report`,
    `${base}/overview/alerts`,
    `${base}/overview/incidents`,
    `${base}/overview/synthetics`,
    `${base}/overview/checkup`,
    `${base}/alarms/list`,
    `${base}/alarms/list/opswatch-e2e-high-cpu`,
    `${base}/alarms/report`,
    `${base}/containers/services`,
    `${base}/containers/deployments`,
    `${base}/databases/instances`,
    `${base}/load-balancers/list`,
    `${base}/load-balancers/objectives`,
    `${base}/instances/list`,
    `${base}/redis/nodes`,
    `${base}/logs/search`,
    `${base}/logs/volume`,
    `${base}/logs/endpoints`,
    `${base}/logs/report`,
    `${base}/errors/groups`,
    `${base}/errors/sources`,
    '/getting-started',
    '/accounts',
    `/accounts/${connectionId}`,
    `/accounts/${connectionId}/collection`,
    '/hosts',
    '/settings',
    '/settings/audit',
    '/settings/backup',
    '/settings/history',
    '/settings/notifications',
    '/settings/repositories',
    '/settings/status',
    '/settings/storage',
    '/docs',
    '/docs/alarms',
    '/docs/searching-logs',
  ];
}
