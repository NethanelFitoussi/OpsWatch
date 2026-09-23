/**
 * The store screenshot story: what OpsWatch is, in the order someone should meet it.
 *
 * One definition, used by every target, so the Play set and the App Store set tell the same story and a screen added
 * here appears in both. Each entry names the screen, how to reach it, and what must be on it before the shutter
 * opens — the last part matters, because a screenshot of a half-loaded screen is worse than no screenshot.
 *
 * **Only capabilities a server implements today.** This is stricter than "the app has the screen", and deliberately.
 * The app has Services, Infrastructure, Logs, Alerts, Incidents, Synthetics, SLOs and Deployments, and they work
 * against the demo — but the server reports every one of them as `false` right now, so somebody installing the app
 * and pointing it at a real OpsWatch would find them unavailable. A store listing that showed them would be selling
 * something the buyer does not get.
 *
 * They come back the moment the server implements them: add the entry here and the matching line in
 * `capture-android.sh`, and the validator fails until every target has been recaptured. The check to run first is
 * `src/lib/api/v1/features.ts` on `main` — the `IMPLEMENTED` map is the list of what may appear here.
 */
export type Shot = {
  /** `01-production-health` — the order is the filename, so the store listing order is the directory order. */
  name: string;
  /** What this screen is for, in the words a store listing would use. Also the caption suggestion. */
  caption: string;
  /** Path to open. Deep links are allow-listed, so these are the app's own routes. */
  path: string;
  /** A testID that must be present and settled before capturing. */
  settleOn: string;
  /** Optional testIDs to tap after arriving, for a screen that is a state rather than a route. */
  tap?: string[];
  /** Scroll down by this many viewport fractions before capturing, for the part of a screen worth showing. */
  scroll?: number;
};

export const STORY: Shot[] = [
  {
    name: '01-production-health',
    caption: 'Is production healthy? The answer, and whether you need to act, in one screen.',
    path: '/',
    settleOn: 'status-hero',
  },
  {
    name: '02-what-changed',
    caption: 'What changed since yesterday, without reading a dashboard.',
    path: '/brief',
    settleOn: 'brief-screen',
  },
  {
    name: '03-problems',
    caption: 'Every open problem, worst first, with what it affects and how long it has been going.',
    path: '/problems',
    settleOn: 'problems-screen',
  },
  {
    name: '04-problem-detail',
    caption: 'Why OpsWatch thinks this is a problem: the evidence, not just a red dot.',
    path: '/problems/prb-checkout-5xx',
    settleOn: 'problem-title',
  },
  {
    name: '05-errors',
    caption: 'Exceptions grouped by fingerprint, with the stack frame that is yours.',
    path: '/errors/err-checkout-currency',
    settleOn: 'error-message',
  },
  {
    name: '06-checkup',
    caption: 'What is wrong with how the environment is set up — and how much of the catalogue could be checked.',
    path: '/checkup',
    settleOn: 'checkup-coverage',
  },
  {
    name: '07-system-status',
    caption: 'Whether OpsWatch itself is collecting — so you know if you can trust the rest.',
    path: '/system',
    settleOn: 'system-verdict',
  },
];

/**
 * The instant every screenshot is taken at. Pinned so a regenerated set differs only where the UI changed, and
 * chosen to be an ordinary weekday mid-morning rather than a suspicious round number.
 *
 * 2026-03-17T09:42:00Z.
 */
export const SCREENSHOT_INSTANT = 1_773_740_520_000;
