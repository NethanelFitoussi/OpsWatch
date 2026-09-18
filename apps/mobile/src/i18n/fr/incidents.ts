import type { incidents as source } from '../en/incidents';

export const incidents: Record<keyof typeof source, string> = {
  'incidents.status.open': 'Ouvert',
  'incidents.status.investigating': 'En cours d’analyse',
  'incidents.status.mitigated': 'Atténué',
  'incidents.status.resolved': 'Résolu',
};
