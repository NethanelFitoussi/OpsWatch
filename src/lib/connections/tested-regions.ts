import type { PermissionTestResult } from '../aws/permission-types';

/**
 * The regions a connection reads that its last permission test never covered (§2.6).
 *
 * Adding a region to a connection that already passed its test does not make the new region readable —
 * the test that passed did not look there. "Connected" and "we have not checked that one" are different
 * answers, and a badge alone cannot say the second, so the page says it in words.
 *
 * Pure: no clock and no database, so the rule is testable on its own.
 */
export function untestedRegions(regions: readonly string[], lastTest: PermissionTestResult | null): string[] {
  if (lastTest === null) return [];
  const covered = new Set(lastTest.checks.map((check) => check.region));
  return regions.filter((region) => !covered.has(region));
}
