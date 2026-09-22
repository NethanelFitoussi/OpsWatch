import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import type { Ref } from '@/api/contract';
import { routeForRef } from '@/lib/deep-links';

/** Opens any OpsWatch object through the deep-link allow-list. Unknown or unsafe refs do nothing. */
export function useOpenRef() {
  const router = useRouter();
  return useCallback(
    (ref: Pick<Ref, 'type' | 'id'>) => {
      const route = routeForRef(ref);
      if (route) router.push(route as Href);
    },
    [router],
  );
}
