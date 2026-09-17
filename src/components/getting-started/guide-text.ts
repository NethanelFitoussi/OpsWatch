import { getTranslations } from 'next-intl/server';
import { richTags } from './rich';

export const json = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * Translators and phrases shared by the three step-by-step guides. getTranslations is cached per request,
 * so each guide can call this on its own.
 */
export async function guideTranslators() {
  const t = await getTranslations('GettingStarted');
  const nav = await getTranslations('Common.nav');
  const accounts = await getTranslations('Accounts');
  const wizard = await getTranslations('Wizard');
  const detail = await getTranslations('AccountDetail');
  const checklist = await getTranslations('Checklist');
  const rich = (key: string, values: Record<string, string | number> = {}) => t.rich(key, { ...richTags, ...values });

  return {
    t,
    rich,
    wizard,
    detail,
    checklist,
    /** "Open Accounts, then Add": the first sub-step of every "create the connection" step. */
    openAdd: rich('shared.openAdd', { accounts: nav('accounts'), add: accounts('add') }),
    /** Wizard and checklist labels quoted by the guide text. */
    createValues: {
      name: wizard('name'),
      accountId: wizard('accountId'),
      regions: wizard('regions'),
      submit: wizard('submit'),
      run: checklist('run'),
    },
    /** How to find the role or instance identity OpsWatch runs with on AWS. */
    findRole: rich('role.steps.s0.aws.i1'),
  };
}
