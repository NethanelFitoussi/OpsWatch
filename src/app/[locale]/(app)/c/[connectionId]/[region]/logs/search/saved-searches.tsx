'use client';

import { Copy, Pencil, Save, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/navigation';
import type { FormAction } from '@/lib/forms/action-state';
import { SAVED_SEARCH_NAME_MAX, savedSearchParams, type SavedSearchFields } from '@/lib/monitoring/shared/saved-search';
import type { SavedSearchState } from './actions';

/**
 * One person's saved searches.
 *
 * A saved search is a **shortcut back to a search**, not a report and not a subscription: nothing here
 * runs on its own, nothing is shared, and nothing leaves the instance. Loading one is an ordinary
 * navigation to the same page with the same query string it would have had — so a saved search is also a
 * link somebody can paste into a ticket, and the back button undoes loading it.
 *
 * Only a relative range is ever stored. `Last hour` still means something next Tuesday.
 */

export type SavedRow = SavedSearchFields & { id: string };

/** The three write actions, already bound to the locale and the environment by the server component. */
export type SavedSearchActions = {
  save: FormAction<SavedSearchState>;
  duplicate: FormAction<SavedSearchState>;
  remove: FormAction<SavedSearchState>;
};

const EMPTY: SavedSearchState = {};

/** The current, unsaved state of the search form, as the hidden fields every write action reads. */
function Fields({ fields, id, name }: { fields: SavedSearchFields; id?: string; name?: string }) {
  return (
    <>
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      {name !== undefined && <input type="hidden" name="name" value={name} />}
      <input type="hidden" name="q" value={fields.text} />
      <input type="hidden" name="level" value={fields.level ?? ''} />
      <input type="hidden" name="limit" value={fields.limit} />
      <input type="hidden" name="range" value={fields.range} />
      <input type="hidden" name="query" value={fields.query ?? ''} />
      {fields.logGroups.map((group) => (
        <input key={group} type="hidden" name="group" value={group} />
      ))}
    </>
  );
}

function Problem({ state }: { state: SavedSearchState }) {
  const t = useTranslations('Monitoring.client');
  if (state.error === undefined) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {t(`logs.saved.errors.${state.error}`)}
    </p>
  );
}

function SavedRowItem({
  row,
  current,
  basePath,
  actions,
}: {
  row: SavedRow;
  current: SavedSearchFields;
  basePath: string;
  actions: SavedSearchActions;
}) {
  const t = useTranslations('Monitoring.client');
  const [renaming, setRenaming] = useState(false);
  const [updateState, update] = useActionState(actions.save, EMPTY);
  const [renameState, rename] = useActionState(actions.save, EMPTY);
  const [copyState, copy] = useActionState(actions.duplicate, EMPTY);
  const [removeState, remove] = useActionState(actions.remove, EMPTY);

  return (
    <li className="space-y-1 border-b py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        {/* Loading is a navigation: the URL it restores is the URL it was saved from. */}
        <Link href={`${basePath}?${savedSearchParams(row)}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
          {row.name}
        </Link>
        <div className="flex shrink-0 items-center">
          <form action={update}>
            {/* Overwrites the stored search with what is in the form right now. */}
            <Fields fields={current} id={row.id} name={row.name} />
            <Button type="submit" variant="ghost" size="sm" className="size-7 p-0" aria-label={t('logs.saved.update', { name: row.name })}
              title={t('logs.saved.update', { name: row.name })}>
              <Save className="size-3.5" aria-hidden />
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            aria-label={t('logs.saved.rename', { name: row.name })}
              title={t('logs.saved.rename', { name: row.name })}
            aria-expanded={renaming}
            onClick={() => setRenaming((value) => !value)}
          >
            <Pencil className="size-3.5" aria-hidden />
          </Button>
          <form action={copy}>
            <input type="hidden" name="id" value={row.id} />
            <Button type="submit" variant="ghost" size="sm" className="size-7 p-0" aria-label={t('logs.saved.duplicate', { name: row.name })}
              title={t('logs.saved.duplicate', { name: row.name })}>
              <Copy className="size-3.5" aria-hidden />
            </Button>
          </form>
          <form action={remove}>
            <input type="hidden" name="id" value={row.id} />
            <Button type="submit" variant="ghost" size="sm" className="size-7 p-0" aria-label={t('logs.saved.delete', { name: row.name })}
              title={t('logs.saved.delete', { name: row.name })}>
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
          </form>
        </div>
      </div>

      {renaming && (
        // Renaming carries the row's **stored** fields, so changing a name never quietly rewrites the search.
        <form action={rename} className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={`rename-${row.id}`} className="text-xs">
              {t('logs.saved.newName')}
            </Label>
            <Input id={`rename-${row.id}`} name="name" defaultValue={row.name} maxLength={SAVED_SEARCH_NAME_MAX} className="h-8 text-xs" />
          </div>
          <Fields fields={row} id={row.id} />
          <Button type="submit" size="sm" className="h-8">
            {t('logs.saved.save')}
          </Button>
        </form>
      )}

      <Problem state={updateState} />
      <Problem state={renameState} />
      <Problem state={copyState} />
      <Problem state={removeState} />
    </li>
  );
}

export function SavedSearches({
  rows,
  current,
  basePath,
  actions,
}: {
  rows: SavedRow[];
  current: SavedSearchFields;
  basePath: string;
  actions: SavedSearchActions;
}) {
  const t = useTranslations('Monitoring.client');
  const [saveState, save] = useActionState(actions.save, EMPTY);

  return (
    <div className="space-y-3">
      <form action={save} className="space-y-2">
        <Label htmlFor="saved-name" className="text-xs">
          {t('logs.saved.nameThis')}
        </Label>
        <div className="flex items-end gap-2">
          <Input id="saved-name" name="name" maxLength={SAVED_SEARCH_NAME_MAX} className="h-8 text-xs" placeholder={t('logs.saved.placeholder')} />
          <Fields fields={current} />
          <Button type="submit" size="sm" className="h-8" disabled={current.logGroups.length === 0}>
            {t('logs.saved.save')}
          </Button>
        </div>
        {/* Saving needs something to search: the cap and the bounds are the query API's own. */}
        {current.logGroups.length === 0 && <p className="text-xs text-muted-foreground">{t('logs.saved.needGroups')}</p>}
        <Problem state={saveState} />
      </form>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('logs.saved.none')}</p>
      ) : (
        <ul aria-label={t('logs.saved.title')}>
          {rows.map((row) => (
            <SavedRowItem key={row.id} row={row} current={current} basePath={basePath} actions={actions} />
          ))}
        </ul>
      )}
    </div>
  );
}
