import 'server-only';
import { createCredentialResolver } from '../aws/credentials';

/** One resolver per server process so assumed-role credentials are cached across requests. */
export const credentialResolver = createCredentialResolver();
