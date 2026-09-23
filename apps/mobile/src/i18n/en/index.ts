/** English catalogue, the source of truth. One file per namespace so features can grow independently. */
import { common } from './common';
import { auth } from './auth';
import { home } from './home';
import { settings } from './settings';
import { problems } from './problems';
import { errors } from './errors';
import { services } from './services';
import { infrastructure } from './infrastructure';
import { logs } from './logs';
import { alerts } from './alerts';
import { incidents } from './incidents';
import { synthetics } from './synthetics';
import { slos } from './slos';
import { deployments } from './deployments';
import { investigations } from './investigations';
import { ai } from './ai';
import { search } from './search';
import { system } from './system';
import { checkup } from './checkup';

export const en = {
  ...common,
  ...auth,
  ...home,
  ...settings,
  ...problems,
  ...errors,
  ...services,
  ...infrastructure,
  ...logs,
  ...alerts,
  ...incidents,
  ...synthetics,
  ...slos,
  ...deployments,
  ...investigations,
  ...ai,
  ...search,
  ...system,
  ...checkup,
} as const;

export type MessageKey = keyof typeof en;
