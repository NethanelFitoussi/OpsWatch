/**
 * The name OpsWatch gives its own CloudWatch subscription filters.
 *
 * It carries the connection id, so two OpsWatch instances watching the same AWS account do not fight over
 * one filter — and so OpsWatch can tell its own filter from another vendor's. Subscription filters take no
 * tags, so the name is the only place ownership can be written.
 *
 * Client-safe on purpose: the browser renders these names beside a conflict, and a module under
 * `monitoring/shared` may not reach for `node:crypto`.
 */
export const OPSWATCH_FILTER_PREFIX = 'OpsWatch-';
export const filterNameFor = (connectionId: string) => `${OPSWATCH_FILTER_PREFIX}${connectionId}`;
export const isOpsWatchFilter = (name: string) => name.startsWith(OPSWATCH_FILTER_PREFIX);
