import 'server-only';
import type { ConnectionRow } from '../db/schema';
import { detectBaseIdentity, trustFor } from '../aws/identity';
import { renderTemplateYaml } from '../aws/template';

/** A role connection that has an ExternalId, so a template can be rendered for it. */
export type TemplateReadyConnection = ConnectionRow & { method: 'role'; externalId: string };

export function isTemplateReady(row: ConnectionRow): row is TemplateReadyConnection {
  return row.method === 'role' && row.externalId !== null;
}

/** Renders the CloudFormation template trusting OpsWatch's base identity. Throws when that identity is unknown. */
export async function renderConnectionTemplate(row: TemplateReadyConnection): Promise<string> {
  const identity = await detectBaseIdentity(row.regions[0]);
  return renderTemplateYaml({ connectionId: row.id, externalId: row.externalId, trust: trustFor(identity) });
}
