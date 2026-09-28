import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '@/lib/connections/types';
import {
  MONITORING_CAPABILITIES,
  PROVIDER_CAPABILITIES,
  capabilitiesOf,
  providersSupporting,
  supports,
} from '@/lib/monitoring/capabilities';
import { MONITORING_PROVIDERS, capabilityIsBacked, monitoringProvider } from '@/lib/monitoring/provider-registry';
import { PROVIDER_FAMILIES, familiesOf } from '@/lib/monitoring/shared/families';
import { PROBLEM_FAMILIES, kindsOfFamily } from '@/lib/detect/family';
import { HEALTH_FAMILIES } from '@/lib/read/health';
import { INSIGHT_FAMILIES } from '@/lib/monitoring/overview';

/**
 * What each provider can do, and whether it can actually do it.
 *
 * A capability table is a list of promises, and the code that keeps them lives somewhere else. That is
 * exactly the arrangement that drifts: a provider gains a declaration during one piece of work and the
 * implementation during another that never happens. This product calls the result an unearned green
 * and treats it as a defect, so the table is checked against the registry rather than trusted.
 */

describe('the capability table', () => {
  it('covers every provider and every capability, with no gaps to read as a no', () => {
    // A missing entry would be `undefined`, which a page would render as neither supported nor not.
    for (const provider of PROVIDERS) {
      const declared = capabilitiesOf(provider);
      for (const capability of MONITORING_CAPABILITIES) {
        expect(declared[capability], `${provider}.${capability}`).toBeDefined();
        expect(['supported', 'not_offered', 'not_built']).toContain(declared[capability].state);
      }
    }
  });

  it('THE RULING: a capability it claims is a capability something can serve', () => {
    const unbacked: string[] = [];
    for (const provider of PROVIDERS) {
      for (const capability of MONITORING_CAPABILITIES) {
        if (!capabilityIsBacked(provider, capability)) unbacked.push(`${provider}.${capability}`);
      }
    }
    expect(unbacked).toEqual([]);
  });

  it('THE RULING: no capability is available only by sending data to OpsWatch', () => {
    /*
     * Direct is the default and the only mode that may be required. A capability offered solely as
     * `managed` would mean an operator had to forward their data — deploy a Lambda, install an agent,
     * push to somebody else's infrastructure — to use a part of the product, and a self-hosted
     * installation that wants none of that would be locked out of it.
     */
    for (const provider of PROVIDERS) {
      for (const capability of MONITORING_CAPABILITIES) {
        const declared = capabilitiesOf(provider)[capability];
        if (declared.state !== 'supported') continue;
        expect(declared.modes, `${provider}.${capability}`).toContain('direct');
      }
    }
  });

  it('tells "this provider has no such thing" from "OpsWatch has not built it"', () => {
    // Two different sentences with two different consequences: one is the end of the matter, the
    // other is a thing that may arrive. Collapsing them into "unsupported" would be true and useless.
    expect(capabilitiesOf('do').logs.state).toBe('not_offered');
    expect(capabilitiesOf('gcp').logs.state).toBe('not_built');
    expect(capabilitiesOf('aws').logs.state).toBe('supported');
  });

  it('agrees with itself about who supports what', () => {
    for (const capability of MONITORING_CAPABILITIES) {
      const listed = providersSupporting(capability);
      for (const provider of PROVIDERS) {
        expect(listed.includes(provider), `${provider}.${capability}`).toBe(supports(provider, capability));
      }
    }
  });
});

describe('the registry behind the table', () => {
  it('has an entry for every provider, so a new one cannot be half-added', () => {
    for (const provider of PROVIDERS) expect(MONITORING_PROVIDERS[provider]?.provider).toBe(provider);
  });

  it('THE RULING: a provider with families has a loader, and one without claims neither health nor problems', () => {
    for (const provider of PROVIDERS) {
      const implementation = monitoringProvider(provider);
      if (implementation.families.length > 0) {
        expect(implementation.loadFamily, provider).not.toBeNull();
      } else {
        // Nothing to read means no verdict to give. Claiming health here would be claiming to have
        // looked at an estate nothing has looked at.
        expect(capabilitiesOf(provider).health.state, provider).not.toBe('supported');
        expect(capabilitiesOf(provider).problems.state, provider).not.toBe('supported');
      }
    }
  });

  it('keeps AWS reading exactly the families it always has', () => {
    expect(monitoringProvider('aws').families).toEqual(['ecs', 'rds', 'alb', 'alarms']);
  });

  it('refuses a family a provider does not have, rather than reporting an empty one', async () => {
    // An empty summary would be recorded as "read it, nothing wrong" — a green mark for a look that
    // never happened, which is the one thing the detect cycle must never write.
    const aws = monitoringProvider('aws');
    const result = await aws.loadFamily!('not-a-family', {} as never, 0);
    expect(result).toMatchObject({ ok: false, code: 'unsupported_family' });
  });
});

describe('a detect cycle counts its own provider’s families', () => {
  it('THE RULING: a provider that read everything it has is not reported as truncated', async () => {
    /*
     * The cycle loops over `monitoring.families` and used to report `total: INSIGHT_FAMILIES.length` —
     * AWS's four. A provider with two families, having read both, would have been recorded as having
     * seen half its estate for ever, and System status would have shown a permanent partial read.
     */
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../../src/lib/collector/detect.ts', import.meta.url), 'utf8'),
    );
    const summary = source.slice(source.indexOf('covered: read.size'));
    expect(summary).toContain('total: monitoring.families.length');
    expect(summary).toContain('truncated: read.size < monitoring.families.length');
    // And not the constant it was, anywhere in that summary.
    expect(summary.slice(0, 400)).not.toContain('INSIGHT_FAMILIES.length');
  });
});

describe('the family list, which used to be four family lists', () => {
  /*
   * `INSIGHT_FAMILIES` (what the cycle reads), `HEALTH_FAMILIES` (what the Health page shows) and
   * `PROBLEM_FAMILIES` (what a problem belongs to, and through it what the report sections are) were
   * three separate declarations of the same four strings. They were separate for a real reason — the
   * read layer must not import the collector, and the detect layer must not import the AWS stack — but
   * the consequence was that a fifth family added in the obvious place would have been read by the
   * cycle and absent from Health and from the report, showing as neither healthy nor unknown.
   */

  it('THE RULING: a family added once is added everywhere', () => {
    // Identity, not equality: three arrays that happen to match today is the situation this replaces.
    expect(INSIGHT_FAMILIES).toBe(PROVIDER_FAMILIES.aws);
    expect(HEALTH_FAMILIES).toBe(PROVIDER_FAMILIES.aws);
    expect(PROBLEM_FAMILIES).toBe(PROVIDER_FAMILIES.aws);
  });

  it('THE RULING: every family has a detector that can put a problem in it', () => {
    // A family with no kinds would be a Health row that is permanently healthy, because nothing can
    // ever be filed under it — the shape of an unearned green that no failing test would show.
    for (const family of PROVIDER_FAMILIES.aws) {
      expect(kindsOfFamily(family), family).not.toHaveLength(0);
    }
  });

  it('gives the registry and the capability table the same list', () => {
    for (const provider of PROVIDERS) {
      expect(monitoringProvider(provider).families, provider).toBe(familiesOf(provider));
      /*
       * And the two ways of saying "problems are computed here" agree with each other. `problems`
       * rather than `health`: Google has a family and produces problems from it, and does **not**
       * have a Health page, because the section rail that shows one is ten AWS services. They are
       * different claims and the table keeps them apart.
       */
      const declared = PROVIDER_CAPABILITIES[provider].problems.state;
      expect(familiesOf(provider).length > 0, provider).toBe(declared === 'supported');
    }
  });
});
