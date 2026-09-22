import { sectionRedirect } from './section-redirect';

/**
 * The environment root, `/c/<connectionId>/<region>`. Not a page either: it opens the default section, the
 * same way each section root opens its first sub-page.
 *
 * It exists because that path is a real address. `?env=<connectionId>:<scope>` is the pair every API call is
 * scoped to, `parseMonitoringPath` already parses a bare environment path, and it is what a bookmark or a
 * shared link is most likely to be trimmed to. Without this it answered 404.
 */
export default sectionRedirect('overview');
