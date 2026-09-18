/**
 * Every URL the operating system hands to the app (URL scheme, universal/app link, notification) passes through here
 * before the router sees it. Only allow-listed destinations survive; everything else opens Home. The destination is
 * also remembered so it can be restored after sign-in.
 */
import Constants from 'expo-constants';
import { parseDeepLink } from '@/lib/deep-links';
import { pendingLink } from '@/state/pending-link';

const associatedDomain = (Constants.expoConfig?.ios?.associatedDomains?.[0] ?? '').replace(/^applinks:/, '') || undefined;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    // The Google sign-in redirect is consumed by the auth session itself.
    if (/^opswatch:\/\/\/?auth\/callback/.test(path) || path.startsWith('/auth/callback')) return '/auth/callback';
    const target = parseDeepLink(path, { associatedDomain });
    if (!target) return '/';
    if (target !== '/') pendingLink.set(target);
    return target;
  } catch {
    return '/';
  }
}
