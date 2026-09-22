/**
 * The offline cache is written to unencrypted storage, so what may be persisted is an explicit allow-list.
 * This test fails when a new query root is persisted by accident, or when a sensitive one is.
 */
import { keys } from '../queries';
import { PERSISTED_ROOTS, shouldPersistQuery } from '../query-provider';

const success = { status: 'success' } as never;
const scope = { env: 'prod' };

it('persists exactly the glanceable list roots', () => {
  expect([...PERSISTED_ROOTS].sort()).toEqual(['brief', 'environments', 'health', 'incidents', 'problems', 'services']);
});

it.each([
  ['health', keys.health(scope), true],
  ['brief', keys.brief(scope), true],
  ['problems list', keys.problems(scope, {}), true],
  ['services list', keys.services(scope), true],
  ['incidents list', keys.incidents(scope), true],
  ['environments', keys.environments(), true],
  ['problem detail (evidence)', keys.problem(scope, 'p'), false],
  ['error detail (stack traces)', keys.error(scope, 'e'), false],
  ['errors list', keys.errors(scope, {}), false],
  ['logs', keys.logs(scope, { from: 0, to: 1 }), false],
  ['investigation', keys.investigation(scope, 'i'), false],
  ['repository evidence', keys.evidence(scope, 'x'), false],
  ['search', keys.search(scope, 'q'), false],
  ['alerts', keys.alerts(scope, {}), false],
  ['favorites', keys.favorites(), false],
])('%s → %s', (_name, queryKey, expected) => {
  expect(shouldPersistQuery({ queryKey: [...queryKey], state: success })).toBe(expected);
});

it('never persists a failed query', () => {
  expect(shouldPersistQuery({ queryKey: [...keys.health(scope)], state: { status: 'error' } as never })).toBe(false);
});
