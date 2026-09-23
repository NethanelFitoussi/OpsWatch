/**
 * The investigation engine: three bands, kept strictly apart (§7).
 *
 * The whole value of this feature is the separation, not the content. An operator reading a timeline has to
 * be able to tell, without effort, which lines are things that happened, which are two things that happened
 * near each other, and which are a guess. Merge them and the guess inherits the authority of the fact.
 *
 *   1. **Observed fact** — a row from the events spine, with a source and a timestamp. *Never inferred.*
 *   2. **Correlation** — two facts within Δt, with a declared relation. States the gap. *Never says because.*
 *   3. **Hypothesis** — a named entry from a fixed catalogue, with a confidence and what would confirm it.
 *
 * Pure, so the whole catalogue can be run against fixtures. Nothing here reads a clock, a database or AWS.
 */

/** §7's window for a correlation: two facts closer than this are worth putting side by side. */
export const CORRELATION_WINDOW_MS = 15 * 60_000;
/** §5's wider window for a deployment, which still counts but carries less weight. */
export const DEPLOYMENT_WINDOW_MS = 30 * 60_000;
/** §5's `noise`: this many reopenings in a day, with nothing else, is a detector problem not an estate one. */
export const FLAP_THRESHOLD = 3;
export const FLAP_WINDOW_MS = 24 * 60 * 60_000;

export type Confidence = 'low' | 'medium' | 'high';

/** One thing that happened. The `type` is the event kind, so a fact can always be traced to its row. */
export type Fact = {
  id: string;
  at: number;
  type: string;
  subjectId: string;
  serviceId: string | null;
  values: Record<string, string | number>;
};

export type Relation = 'same_service' | 'same_subject';

export type Correlation = {
  id: string;
  /** The later of the two, which is when the pair became observable. */
  at: number;
  earlier: Fact;
  later: Fact;
  /** The measured gap, which is the entire claim being made. */
  minutesApart: number;
  relation: Relation;
};

export type Hypothesis = {
  id: string;
  confidence: Confidence;
  /** The fact and correlation ids it rests on, so a reader can check the reasoning rather than trust it. */
  supporting: string[];
  /** One line saying what would settle it, per §7. */
  confirmedBy: string;
};

/**
 * Facts, from events. One event becomes one fact and nothing else becomes a fact at all — §7's "a fact is
 * never inferred" is enforced by this function having no other input.
 */
export type EventLike = {
  id: string;
  at: number;
  kind: string;
  subjectId: string;
  serviceId: string | null;
  payload: Record<string, unknown>;
};

export function factsFrom(events: readonly EventLike[]): Fact[] {
  return events
    .map((event) => ({
      id: event.id,
      at: event.at,
      type: event.kind,
      subjectId: event.subjectId,
      serviceId: event.serviceId,
      values: Object.fromEntries(
        Object.entries(event.payload ?? {}).filter(
          (entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number',
        ),
      ),
    }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** The declared relation between two facts, or null when there is none — which means no correlation (§7). */
export function relationBetween(a: Fact, b: Fact): Relation | null {
  if (a.subjectId === b.subjectId) return 'same_subject';
  if (a.serviceId !== null && a.serviceId === b.serviceId) return 'same_service';
  return null;
}

/**
 * Facts that happened near the anchor and share a declared relation with it.
 *
 * Both halves are required. Without a relation, any two things happening at once in a busy account look
 * correlated, which is how a correlation feature becomes noise; without the window, everything that ever
 * touched the service does.
 */
export function correlationsFor(anchor: Fact, facts: readonly Fact[], windowMs = CORRELATION_WINDOW_MS): Correlation[] {
  return facts
    .filter((fact) => fact.id !== anchor.id)
    .map((fact) => {
      const relation = relationBetween(anchor, fact);
      if (relation === null) return null;
      const gap = Math.abs(anchor.at - fact.at);
      // A deployment is allowed its wider window; everything else uses §7's.
      const allowed = fact.type.startsWith('deployment_') ? Math.max(windowMs, DEPLOYMENT_WINDOW_MS) : windowMs;
      if (gap > allowed) return null;
      const [earlier, later] = fact.at <= anchor.at ? [fact, anchor] : [anchor, fact];
      return { id: `${earlier.id}:${later.id}`, at: later.at, earlier, later, minutesApart: Math.round(gap / 60_000), relation };
    })
    .filter((correlation): correlation is Correlation => correlation !== null)
    .sort((a, b) => a.minutesApart - b.minutesApart || a.id.localeCompare(b.id));
}

/**
 * §7's catalogue, restricted to the entries this build can actually evaluate.
 *
 * The others — `traffic_surge`, `query_regression`, `upstream_edge`, `certificate_or_dns`,
 * `dependency_saturation` — need baselines, Performance Insights digests, Cloudflare or synthetics, none of
 * which is collected. They are listed in `NOT_EVALUATED` rather than quietly omitted, so a reader can see
 * the catalogue was not fully run. Same rule as Checkup, for the same reason.
 */
export const NOT_EVALUATED = ['dependency_saturation', 'traffic_surge', 'query_regression', 'upstream_edge', 'certificate_or_dns'] as const;

export type ProblemContext = {
  kind: string;
  firstSeenAt: number;
  /**
   * How many times this problem reopened **within `FLAP_WINDOW_MS`**, not over its lifetime.
   *
   * §5 says "flapped ≥ 3 times in 24 h", and the stored counter is a lifetime total — a problem that
   * reopened three times last March would otherwise be called noise today. The caller counts the reopen
   * events in the window, which is the only reading that matches what the rule says.
   */
  reopensInWindow: number;
  serviceId: string | null;
};

export function hypothesesFor(problem: ProblemContext, facts: readonly Fact[], correlations: readonly Correlation[]): Hypothesis[] {
  const found: Hypothesis[] = [];

  const deployments = correlations.filter(
    (correlation) => correlation.earlier.type.startsWith('deployment_') && correlation.earlier.at <= problem.firstSeenAt,
  );
  const errorSignals = facts.filter(
    (fact) => (fact.type === 'error_group_appeared' || fact.type === 'error_group_regressed') && Math.abs(fact.at - problem.firstSeenAt) <= CORRELATION_WINDOW_MS,
  );

  if (deployments.length > 0) {
    // §5: a deployment and an error signal together is high; either alone is medium.
    found.push({
      id: 'deploy_regression',
      confidence: errorSignals.length > 0 ? 'high' : 'medium',
      supporting: [...deployments.map((one) => one.id), ...errorSignals.map((one) => one.id)],
      confirmedBy: 'deploy_regression.confirm',
    });
  }

  // §5: tasks below desired or unhealthy targets, *without* a deployment — the absence is the point, since
  // the same symptom during a rollout is an ordinary deployment in progress rather than a capacity problem.
  const capacityKinds = ['ecs_tasks_below_desired', 'alb_unhealthy_hosts'];
  if (capacityKinds.includes(problem.kind) && deployments.length === 0) {
    found.push({ id: 'capacity_shortfall', confidence: 'high', supporting: [], confirmedBy: 'capacity_shortfall.confirm' });
  }

  // §5's `noise`: it proposes tuning the detector rather than looking at the estate.
  if (problem.reopensInWindow >= FLAP_THRESHOLD && facts.length === 0) {
    found.push({ id: 'noise', confidence: 'medium', supporting: [], confirmedBy: 'noise.confirm' });
  }

  const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  // §7: by confidence, then by how many facts support them.
  return found.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.supporting.length - a.supporting.length);
}
