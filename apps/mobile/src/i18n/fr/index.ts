/** French catalogue. Each namespace file is typed against its English counterpart, so a missing key fails typecheck. */
import type { MessageKey } from '../en';
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

export const fr: Record<MessageKey, string> = {
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
};
