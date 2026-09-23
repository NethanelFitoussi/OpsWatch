export const checkup = {
  'nav.checkup': 'Checkup',
  'checkup.subtitle': 'What is wrong with how this environment is set up.',
  'checkup.difference':
    'A finding is about configuration and stays until someone changes a setting. A problem is something breaking now, and goes away when it stops.',

  // Coverage comes before findings, always. "Nothing to report" from a catalogue where half the checks could not run
  // is a claim, not a measurement, and the app does not make claims it cannot support.
  'checkup.coverage': '{ran} of {total} checks ran',
  'checkup.coverage.all': 'All {total} checks ran',
  'checkup.coverage.notRun': '{notRun} could not run',
  'checkup.findings': 'Findings',
  'checkup.notRun': 'Checks that could not run',
  'checkup.empty.title': 'Nothing to report',
  'checkup.empty.body': 'Every check that ran found nothing wrong with how this environment is set up.',
  'checkup.empty.partial': 'Nothing was found by the checks that ran. The ones below could not run, so this is not a clean bill of health.',

  'checkup.reason.denied': 'The permission this needs was refused, so the answer cannot be known from here.',
  'checkup.reason.not_collected': 'OpsWatch does not collect the data this check reads yet.',
  'checkup.reason.cap': 'The scope was cut short to stay inside the query budget.',
  'checkup.reason.unsupported': 'This resource cannot answer the question.',

  // One per check the server can emit. A server newer than this app may send an id that is not here; the screen
  // then names the check rather than pretending it understood it.
  'checkup.check.permissions_untested': 'This connection has never been tested',
  'checkup.check.permissions_denied': 'AWS refused {count} permission(s): {services}',
  'checkup.check.permissions_errored': 'AWS returned an error for {count} permission(s): {services}',
  'checkup.check.account_mismatch': 'The credentials reach a different AWS account than the one configured',
  'checkup.check.family_unreadable': '{family} could not be read ({reason})',
  'checkup.check.errors_not_collected': 'No log group is switched on, so no errors are being collected',
  'checkup.check.history_off': 'Historical collection is off, so there are no baselines, SLOs or long-term reports',
  'checkup.check.logs_budget': 'Log scanning budget',
  'checkup.check.logs_budget_exhausted': 'Today’s log scanning budget is used up ({scanned} of {limit} GB)',
  'checkup.check.collector_never_ran': 'The collector has never run, so nothing has been measured',
  'checkup.check.collector_job_failing': '{count} collection job(s) failing: {jobs}',
  'checkup.check.template_outdated': 'The CloudFormation stack is version {version}; the current one is {current}',
  'checkup.check.unknown': 'A check this app does not recognise ({id})',

  // A check that could not run has no values, so it cannot be described by the sentence a *finding* uses — that
  // sentence has placeholders nothing will fill, and they reach the screen as literal braces. What a reader needs
  // there is the name of the check that did not happen.
  'checkup.name.permissions_untested': 'Connection test',
  'checkup.name.permissions_denied': 'AWS permissions',
  'checkup.name.permissions_errored': 'AWS permissions',
  'checkup.name.account_mismatch': 'AWS account match',
  'checkup.name.family_unreadable': 'Resource readability',
  'checkup.name.errors_not_collected': 'Error collection',
  'checkup.name.history_off': 'Historical collection',
  'checkup.name.logs_budget': 'Log scanning budget',
  'checkup.name.logs_budget_exhausted': 'Log scanning budget',
  'checkup.name.collector_never_ran': 'Collector',
  'checkup.name.collector_job_failing': 'Collection jobs',
  'checkup.name.template_outdated': 'CloudFormation stack version',
  'checkup.name.unknown': 'A check this app does not recognise ({id})',
} as const;
