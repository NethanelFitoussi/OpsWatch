/**
 * Data hooks. Screens use these and nothing else to reach the server. Keys start with a resource root (used by the
 * persistence allow-list in query-provider.tsx), then `list` or `detail`, then the environment scope.
 */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { AlertFilters, ErrorFilters, LogQuery, ProblemFilters, Scope } from './client';
import type { Favorite, InfraCategory, Page, Ref } from './contract';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';

export function useScope(): Scope {
  const { settings } = useSettings();
  return useMemo(() => ({ env: settings.environmentId ?? undefined }), [settings.environmentId]);
}

export const keys = {
  environments: () => ['environments', 'list'] as const,
  health: (s: Scope) => ['health', 'list', s.env ?? null] as const,
  brief: (s: Scope) => ['brief', 'list', s.env ?? null] as const,
  problems: (s: Scope, f: ProblemFilters) => ['problems', 'list', s.env ?? null, f] as const,
  problem: (s: Scope, id: string) => ['problems', 'detail', s.env ?? null, id] as const,
  errors: (s: Scope, f: ErrorFilters) => ['errors', 'list', s.env ?? null, f] as const,
  error: (s: Scope, id: string) => ['errors', 'detail', s.env ?? null, id] as const,
  services: (s: Scope) => ['services', 'list', s.env ?? null] as const,
  service: (s: Scope, id: string) => ['services', 'detail', s.env ?? null, id] as const,
  infrastructure: (s: Scope, c?: InfraCategory) => ['infrastructure', 'list', s.env ?? null, c ?? null] as const,
  infrastructureResource: (s: Scope, id: string) => ['infrastructure', 'detail', s.env ?? null, id] as const,
  logs: (s: Scope, q: LogQuery) => ['logs', 'list', s.env ?? null, q] as const,
  alerts: (s: Scope, f: AlertFilters) => ['alerts', 'list', s.env ?? null, f] as const,
  alert: (s: Scope, id: string) => ['alerts', 'detail', s.env ?? null, id] as const,
  incidents: (s: Scope) => ['incidents', 'list', s.env ?? null] as const,
  incident: (s: Scope, id: string) => ['incidents', 'detail', s.env ?? null, id] as const,
  synthetics: (s: Scope) => ['synthetics', 'list', s.env ?? null] as const,
  synthetic: (s: Scope, id: string) => ['synthetics', 'detail', s.env ?? null, id] as const,
  slos: (s: Scope) => ['slos', 'list', s.env ?? null] as const,
  slo: (s: Scope, id: string) => ['slos', 'detail', s.env ?? null, id] as const,
  deployments: (s: Scope) => ['deployments', 'list', s.env ?? null] as const,
  deployment: (s: Scope, id: string) => ['deployments', 'detail', s.env ?? null, id] as const,
  investigation: (s: Scope, id: string) => ['investigations', 'detail', s.env ?? null, id] as const,
  evidence: (s: Scope, id: string) => ['evidence', 'detail', s.env ?? null, id] as const,
  search: (s: Scope, q: string) => ['search', 'list', s.env ?? null, q] as const,
  favorites: () => ['favorites', 'list'] as const,
};

/** Flattens the pages of an infinite list. */
export function flattenPages<T>(data: InfiniteData<Page<T>> | undefined): T[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}

function useSignedIn(): boolean {
  return useSession().state.status === 'signed-in';
}

export function useEnvironments() {
  const { client } = useSession();
  return useQuery({ queryKey: keys.environments(), queryFn: () => client.environments(), enabled: useSignedIn(), staleTime: 5 * 60_000 });
}

export function useHealth() {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.health(scope), queryFn: () => client.health(scope), enabled: useSignedIn(), refetchInterval: 60_000 });
}

export function useBrief() {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.brief(scope), queryFn: () => client.brief(scope), enabled: useSignedIn(), staleTime: 5 * 60_000 });
}

export function useProblems(filters: ProblemFilters) {
  const { client } = useSession();
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: keys.problems(scope, filters),
    // Changing a filter keeps the previous rows on screen until the new ones arrive.
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => client.problems(scope, filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: useSignedIn(),
  });
}

export function useProblem(id: string) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.problem(scope, id), queryFn: () => client.problem(scope, id), enabled: useSignedIn() });
}

export function useErrors(filters: ErrorFilters) {
  const { client } = useSession();
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: keys.errors(scope, filters),
    // Changing a filter keeps the previous rows on screen until the new ones arrive.
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => client.errors(scope, filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: useSignedIn(),
  });
}

export function useErrorGroup(id: string) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.error(scope, id), queryFn: () => client.error(scope, id), enabled: useSignedIn() });
}

export function useServices() {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.services(scope), queryFn: () => client.services(scope), enabled: useSignedIn() });
}

export function useService(id: string) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.service(scope, id), queryFn: () => client.service(scope, id), enabled: useSignedIn() });
}

export function useInfrastructure(category?: InfraCategory) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.infrastructure(scope, category),
    // Changing a filter keeps the previous rows on screen until the new ones arrive.
    placeholderData: keepPreviousData, queryFn: () => client.infrastructure(scope, category), enabled: useSignedIn() });
}

export function useInfrastructureResource(id: string) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.infrastructureResource(scope, id), queryFn: () => client.infrastructureResource(scope, id), enabled: useSignedIn() });
}

const LOG_POLL_MS = 1500;
const LOG_MAX_POLLS = 40;

/**
 * Log search. The server may answer `running` (CloudWatch Logs Insights is asynchronous): the hook polls until the
 * search completes, and releases the server-side query when a newer search replaces it or the screen goes away.
 */
export function useLogs(query: LogQuery | null) {
  const { client } = useSession();
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: keys.logs(scope, query ?? { from: 0, to: 0 }),
    queryFn: async ({ pageParam, signal }) => {
      let result = await client.searchLogs(scope, query!, pageParam);
      for (let polls = 0; result.status === 'running' && polls < LOG_MAX_POLLS; polls += 1) {
        if (signal.aborted) {
          void client.cancelLogs(scope, result.searchId).catch(() => undefined);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, LOG_POLL_MS));
        result = await client.pollLogs(scope, result.searchId, pageParam);
      }
      return result;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: useSignedIn() && query !== null,
    // Logs are never persisted and go stale quickly.
    gcTime: 5 * 60_000,
    staleTime: 15_000,
  });
}

export function useAlerts(filters: AlertFilters) {
  const { client } = useSession();
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: keys.alerts(scope, filters),
    // Changing a filter keeps the previous rows on screen until the new ones arrive.
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => client.alerts(scope, filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: useSignedIn(),
    refetchInterval: 60_000,
  });
}

export function useAlert(id: string) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.alert(scope, id), queryFn: () => client.alert(scope, id), enabled: useSignedIn() });
}

export function useIncidents() {
  const { client } = useSession();
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: keys.incidents(scope),
    queryFn: ({ pageParam }) => client.incidents(scope, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: useSignedIn(),
  });
}

export function useIncident(id: string) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.incident(scope, id), queryFn: () => client.incident(scope, id), enabled: useSignedIn() });
}

export function useSynthetics() {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.synthetics(scope), queryFn: () => client.synthetics(scope), enabled: useSignedIn(), refetchInterval: 60_000 });
}

export function useSynthetic(id: string) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.synthetic(scope, id), queryFn: () => client.synthetic(scope, id), enabled: useSignedIn() });
}

export function useSlos() {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.slos(scope), queryFn: () => client.slos(scope), enabled: useSignedIn() });
}

export function useSlo(id: string) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.slo(scope, id), queryFn: () => client.slo(scope, id), enabled: useSignedIn() });
}

export function useDeployments() {
  const { client } = useSession();
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: keys.deployments(scope),
    queryFn: ({ pageParam }) => client.deployments(scope, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: useSignedIn(),
  });
}

export function useDeployment(id: string) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.deployment(scope, id), queryFn: () => client.deployment(scope, id), enabled: useSignedIn() });
}

export function useInvestigation(id: string) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.investigation(scope, id), queryFn: () => client.investigation(scope, id), enabled: useSignedIn() });
}

export function useRepositoryEvidence(id: string) {
  const { client } = useSession();
  const scope = useScope();
  return useQuery({ queryKey: keys.evidence(scope, id), queryFn: () => client.repositoryEvidence(scope, id), enabled: useSignedIn() });
}

export function useSearch(text: string) {
  const { client } = useSession();
  const scope = useScope();
  const q = text.trim();
  return useQuery({ queryKey: keys.search(scope, q),
    // Changing a filter keeps the previous rows on screen until the new ones arrive.
    placeholderData: keepPreviousData, queryFn: () => client.search(scope, q), enabled: useSignedIn() && q.length >= 2, staleTime: 30_000 });
}

/**
 * AI answers are mutations: never cached, never persisted, never retried automatically. An answer can take up to a
 * minute, so the caller can give up on it; the request is then cancelled instead of running on unseen.
 */
export function useAsk() {
  const { client } = useSession();
  const scope = useScope();
  const controller = useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationFn: ({ question, context }: { question: string; context?: Ref }) => {
      controller.current?.abort();
      const next = new AbortController();
      controller.current = next;
      return client.ask(scope, question, context, next.signal);
    },
  });
  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    mutation.reset();
  }, [mutation]);
  useEffect(() => () => controller.current?.abort(), []);
  return { ...mutation, cancel };
}

export function useAcknowledgeProblem(id: string) {
  const { client } = useSession();
  const scope = useScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.acknowledgeProblem(scope, id),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ['problems'] }), queryClient.invalidateQueries({ queryKey: ['health'] })]),
  });
}

export function useAcknowledgeAlert(id: string) {
  const { client } = useSession();
  const scope = useScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.acknowledgeAlert(scope, id),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ['alerts'] }), queryClient.invalidateQueries({ queryKey: ['health'] })]),
  });
}

export function useServerFavorites(enabled: boolean) {
  const { client } = useSession();
  return useQuery({ queryKey: keys.favorites(), queryFn: () => client.favorites(), enabled: useSignedIn() && enabled });
}

export function useSaveFavorites() {
  const { client } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: Favorite[]) => client.saveFavorites(items),
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: keys.favorites() });
      const previous = queryClient.getQueryData<Favorite[]>(keys.favorites());
      queryClient.setQueryData(keys.favorites(), items);
      return { previous };
    },
    onError: (_error, _items, context) => queryClient.setQueryData(keys.favorites(), context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.favorites() }),
  });
}
