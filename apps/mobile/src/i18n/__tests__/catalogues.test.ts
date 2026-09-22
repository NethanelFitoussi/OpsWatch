import { en } from '../en';
import { fr } from '../fr';
import { translate } from '..';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

it('French defines every English key and nothing else', () => {
  expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
});

it.each(Object.keys(en))('%s keeps the same placeholders in French', (key) => {
  const k = key as keyof typeof en;
  expect(placeholders(fr[k])).toEqual(placeholders(en[k]));
  expect(fr[k].trim()).not.toBe('');
});

it('fills placeholders and leaves unknown ones visible', () => {
  expect(translate('en', 'state.updatedAgo', { time: '3 min ago' })).toBe('Updated 3 min ago');
  expect(translate('fr', 'state.updatedAgo', {})).toBe('Mis à jour {time}');
});
