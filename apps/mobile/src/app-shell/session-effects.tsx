/**
 * Side effects bound to the session:
 * - after an interactive sign-in, open the destination the user was heading to (deep link, notification);
 * - refresh the server's capabilities when a session starts;
 * - keep the selected environment valid.
 */
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useEnvironments } from '@/api/queries';
import { useSession } from '@/state/session';
import { pendingLink } from '@/state/pending-link';
import { useSettings } from '@/state/settings';

export function SessionEffects() {
  const { state, refreshServerInfo, onSessionEnd } = useSession();
  const router = useRouter();
  const previous = useRef(state.status);
  const { settings, update, resetServerScoped } = useSettings();
  const environments = useEnvironments();

  useEffect(() => {
    const before = previous.current;
    previous.current = state.status;
    if (state.status !== 'signed-in') return;
    void refreshServerInfo();
    if (before === 'signed-out' || before === 'no-server') {
      // Interactive sign-in: restore where the user was going.
      const target = pendingLink.consume();
      if (target && target !== '/') setTimeout(() => router.push(target as Href), 0);
    } else if (before === 'loading') {
      // Cold start while signed in: the router already opened the link itself.
      pendingLink.clear();
    }
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Environment, recent searches and local favorites belong to one server: forget them when the server changes.
  useEffect(
    () =>
      onSessionEnd((reason) => {
        if (reason === 'server-changed') resetServerScoped();
      }),
    [onSessionEnd, resetServerScoped],
  );

  // Default to the first production environment; drop a selection that no longer exists.
  useEffect(() => {
    const list = environments.data;
    if (!list?.length) return;
    const current = settings.environmentId;
    if (current && list.some((e) => e.id === current)) return;
    const fallback = list.find((e) => e.kind === 'production') ?? list[0]!;
    update({ environmentId: fallback.id });
  }, [environments.data, settings.environmentId, update]);

  return null;
}
