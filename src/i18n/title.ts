/** Joins a page title and the app name; with the default `%s` it is the locale layout's `title.template`. */
export function titleTemplate(appName: string, pageTitle = '%s'): string {
  return `${pageTitle} · ${appName}`;
}
