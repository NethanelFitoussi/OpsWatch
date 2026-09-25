import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import { hostGuidance } from '@/lib/monitoring/shared/host-guidance';
import type { HostFinding, HostFindingKind } from '@/lib/monitoring/shared/host-findings';
import type { Host } from '@opswatch/contract';

/**
 * What to check when a machine is in trouble.
 *
 * Two things are held here. The words are **written down and identical every time**, like the metric
 * catalogue's — a model paraphrasing "the disk is nearly full" differently on each render would be
 * worse than the figure it replaced. And the steps are the steps for *this* machine: a step about
 * Redis on a box with no Redis teaches an operator to skim, and a skimmed list is one where the step
 * that mattered was missed.
 */

const KINDS: HostFindingKind[] = ['disk_full', 'disk_nearly_full', 'memory_nearly_exhausted', 'stopped_reporting'];

const host = (services: string[] = []): Host =>
  ({
    id: 'h1',
    name: 'api-prod-03',
    state: 'healthy',
    services: services.map((kind) => ({ kind, name: kind, port: null, version: null, evidence: 'found' })),
    latest: null,
  }) as unknown as Host;

const finding = (kind: HostFindingKind): HostFinding => ({ kind, level: 'critical', subject: '/', percent: 98 });

const at = (tree: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((node, step) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[step] : undefined), tree);

describe('the steps a machine finding offers', () => {
  it('THE RULING: every step it promises exists, in both languages', () => {
    // The renderer asks for exactly `checks` of them. One short and the page prints a key path.
    const missing: string[] = [];
    for (const kind of KINDS) {
      const guidance = hostGuidance(finding(kind), host(['redis', 'docker']));
      const keys = [
        ...Array.from({ length: guidance.checks }, (_, index) => `${kind}.checks.${index}`),
        ...guidance.services.map((service) => `${kind}.services.${service}`),
      ];
      for (const key of keys) {
        for (const [locale, messages] of [['en', en], ['fr', fr]] as const) {
          if (typeof at(messages, `Hosts.guidance.${key}`) !== 'string') missing.push(`${locale} ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('THE RULING: it never offers a step about something the agent did not find', () => {
    // A bare machine gets the general steps and nothing about Redis or Docker.
    expect(hostGuidance(finding('disk_full'), host()).services).toEqual([]);
    expect(hostGuidance(finding('memory_nearly_exhausted'), host()).services).toEqual([]);

    // One found, one not: only the one that is there.
    expect(hostGuidance(finding('disk_full'), host(['redis'])).services).toEqual(['redis']);
    expect(hostGuidance(finding('disk_full'), host(['docker'])).services).toEqual(['docker']);
    // …and a service that has nothing to do with this finding stays out of it.
    expect(hostGuidance(finding('memory_nearly_exhausted'), host(['docker'])).services).toEqual([]);
    expect(hostGuidance(finding('stopped_reporting'), host(['redis', 'docker'])).services).toEqual([]);
  });

  it('gives the owner’s own case the step that is about it', () => {
    // Redis on an Ubuntu box, with the disk filling: the snapshot and the append-only file are the
    // reason often enough that not saying it would be withholding the answer.
    const guidance = hostGuidance(finding('disk_full'), host(['redis']));
    expect(guidance.services).toContain('redis');
    expect(at(en, 'Hosts.guidance.disk_full.services.redis')).toContain('append-only');
  });

  it('says what to check and never what is wrong', () => {
    /*
     * OpsWatch read one figure from one machine. "A log file is growing" would be a guess dressed as a
     * finding; "check whether a log file is growing" is something somebody can act on. Nothing here
     * may assert a cause.
     */
    const asserted = /\b(is caused by|because the|the reason is|this means that your)\b/i;
    for (const kind of KINDS) {
      for (const messages of [en, fr]) {
        const block = at(messages, `Hosts.guidance.${kind}.checks`) as Record<string, string>;
        for (const [index, step] of Object.entries(block)) {
          expect(step, `${kind}.${index}`).not.toMatch(asserted);
        }
      }
    }
  });

  it('THE RULING: a command is marked up as one, not written in backticks nothing parses', () => {
    /*
     * These steps were written in Markdown out of habit, and the page renders text. A reader saw
     * `sudo lsof +L1` with the backticks and had to work out which part to type. Tags render.
     */
    for (const messages of [en, fr]) {
      for (const kind of KINDS) {
        const block = at(messages, `Hosts.guidance.${kind}.checks`) as Record<string, string>;
        for (const [index, step] of Object.entries(block)) {
          expect(step, `${kind}.${index}`).not.toContain('`');
        }
      }
    }
    // And the commands are still there, as tags.
    expect(at(en, 'Hosts.guidance.disk_full.checks.2')).toContain('<code>sudo lsof +L1</code>');
  });

  it('is the same words every time, because a page that changes underneath somebody cannot be learnt', () => {
    const once = hostGuidance(finding('disk_full'), host(['redis']));
    const twice = hostGuidance(finding('disk_full'), host(['redis']));
    expect(once).toEqual(twice);
  });
});
