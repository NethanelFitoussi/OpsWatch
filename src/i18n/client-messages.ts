/**
 * Message namespaces read by client components. Only these are sent to the browser: the rest (mostly
 * the getting started guide) is rendered on the server. tests/unit/client-messages.test.ts checks that
 * every useTranslations call in client code is covered.
 */
export const CLIENT_NAMESPACES = [
  'Common',
  'Shell',
  'Auth',
  'Wizard',
  // The Google Cloud wizard's form and the check button on the connection page.
  'GoogleWizard',
  'GoogleSetup',
  'DoWizard',
  'DoSetup',
  'AccountDetail.details',
  'AccountDetail.role',
  'AccountDetail.keys',
  'Checklist',
  'Collection',
  'ErrorPage',
  'GettingStarted.diagram',
  // The enrol form and the rename form, which are the only client parts of the hosts pages.
  'Hosts.enrol',
  'Hosts.detail',
  'Monitoring.client',
  'Monitoring.sources',
  'Monitoring.endpoints',
  'Monitoring.code',
  'Monitoring.synthetics',
  'Monitoring.objectives',
  'Monitoring.ask',
  'Monitoring.diagnosis',
  'Monitoring.cloudflare',
  'Monitoring.incidents',
  'Monitoring.alerts',
  'Settings',
  'Search',
] as const;

type Tree = { [key: string]: unknown };

export function pickClientMessages(messages: Tree): Tree {
  const picked: Tree = {};
  for (const namespace of CLIENT_NAMESPACES) {
    const path = namespace.split('.');
    let source: unknown = messages;
    let target = picked;
    path.forEach((key, index) => {
      source = (source as Tree | undefined)?.[key];
      if (source === undefined) return;
      if (index === path.length - 1) {
        target[key] = source;
      } else {
        target = (target[key] ??= {}) as Tree;
      }
    });
  }
  return picked;
}
