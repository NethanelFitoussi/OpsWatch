import { describe, expect, it } from 'vitest';
import { CLIENT_NAMESPACES, pickClientMessages } from '@/i18n/client-messages';
import en from '../../messages/en.json';
import { clientModuleGraph, readSource } from '../helpers/source-graph';

/** Message namespaces read with useTranslations in code that runs in the browser. */
function clientNamespaces(): Set<string> {
  const used = new Set<string>();
  for (const file of clientModuleGraph().modules) {
    const source = readSource(file);
    for (const [, variable, namespace] of source.matchAll(/const (\w+) = useTranslations\((?:'([^']+)')?\)/g)) {
      if (namespace) {
        used.add(namespace);
        continue;
      }
      // Without a namespace, every key the translator reads names its own namespace.
      for (const [, key] of source.matchAll(new RegExp(`\\b${variable}\\('([^']+)'`, 'g'))) {
        used.add(key.split('.').slice(0, -1).join('.'));
      }
    }
  }
  return used;
}

const covers = (picked: string, namespace: string) => namespace === picked || namespace.startsWith(`${picked}.`);

describe('client messages', () => {
  it('include every namespace a client component reads', () => {
    const used = [...clientNamespaces()];
    expect(used).toContain('GettingStarted.diagram');
    expect(used.filter((namespace) => !CLIENT_NAMESPACES.some((picked) => covers(picked, namespace)))).toEqual([]);
  });

  it('keep the picked messages and leave the guide text on the server', () => {
    const picked = pickClientMessages(en) as typeof en;
    expect(picked.Common).toEqual(en.Common);
    expect(picked.GettingStarted).toEqual({ diagram: en.GettingStarted.diagram });
    expect(JSON.stringify(picked).length).toBeLessThan(JSON.stringify(en).length / 2);
  });
});
