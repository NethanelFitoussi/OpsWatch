import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { SCREENSHOT_INSTANT, STORY } from './story';

/**
 * Captures the store story. One test per screen so a failure names the screen that broke rather than the whole run.
 *
 * Everything is the demo: the same client, the same fixtures, the same capability set the app really has. Nothing is
 * mocked further and nothing is dressed up for the camera — what is photographed is what the app does.
 */

const ROOT = join(__dirname, '../../../../mobile/store-assets');

/** `apple-6.9` renders go to the Apple preview tree; `play-phone` to the Play tree. */
function outputDir(project: string): string {
  const locale = process.env.OPSWATCH_STORE_LOCALE ?? 'en';
  return project.startsWith('apple')
    ? join(ROOT, 'apple', 'preview-web', locale, project)
    : join(ROOT, 'google-play', 'preview-web', locale, project);
}

/**
 * Waits for the screen to stop changing, rather than for a duration.
 *
 * Text settles immediately; two things do not. Fonts rasterise when they finish loading, which shifts every baseline
 * by a fraction of a pixel. And the charts size themselves from a measured layout, so their paths are only final once
 * that measurement is, which is why the screens with charts were the screens that would not reproduce. Both are
 * invisible to a reader and make every regenerated file differ, so the shutter waits for the geometry to hold still.
 */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const geometry = () => page.evaluate(() => [...document.querySelectorAll('svg path, svg rect, svg line')].map((node) => node.getAttribute('d') ?? `${node.getAttribute('x')},${node.getAttribute('width')}`).join('|'));

  let previous = await geometry();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.waitForTimeout(250);
    const current = await geometry();
    if (current === previous) return;
    previous = current;
  }
}

const LOCALE = (process.env.OPSWATCH_STORE_LOCALE ?? 'en') as 'en' | 'fr';

/**
 * Enters the demo and, for a non-English set, switches the language through the app's own setting rather than a
 * capture-only override. The screenshots then show the language exactly as a user would get it, and no code path
 * exists solely to be photographed.
 */
async function enterDemo(page: Page) {
  await page.goto('/');
  await page.getByTestId('start-demo').click();
  await expect(page.getByTestId('status-title')).toBeVisible();

  if (LOCALE !== 'en') {
    await page.goto('/settings');
    await page.getByTestId(`chip-${LOCALE}`).click();
    await expect(page.getByTestId(`chip-${LOCALE}`)).toBeVisible();
  }
}

test.describe('store screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await enterDemo(page);
  });

  for (const shot of STORY) {
    test(shot.name, async ({ page }, testInfo) => {
      await page.goto(shot.path);
      await expect(page.getByTestId(shot.settleOn)).toBeVisible();
      for (const target of shot.tap ?? []) await page.getByTestId(target).click();
      if (shot.scroll) await page.mouse.wheel(0, shot.scroll * (page.viewportSize()?.height ?? 0));

      await settle(page);

      const dir = outputDir(testInfo.project.name);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${shot.name}.png`), animations: 'disabled', caret: 'hide' });

      /**
       * The text of the screen, beside the image.
       *
       * The content is deterministic — same instant, same fixtures, same words every run — but the PNG bytes are
       * not: a browser's rasteriser antialiases a fraction differently from run to run, which is invisible to a
       * reader and makes every image differ in git. So the reviewable artefact is this file. If it does not change,
       * nothing a user would notice changed; if it does, the diff says exactly what.
       */
      const text = (await page.locator('body').innerText()).split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
      writeFileSync(join(dir, `${shot.name}.txt`), `# ${shot.caption}\n# route: ${shot.path}\n\n${text}\n`, 'utf8');
    });
  }
});

/**
 * Refuses to accept a set taken with a live clock.
 *
 * This is not hypothetical: the export and the capture are separate commands, and a `dist-web` built by any other
 * command has no pinned instant. The captures then look completely normal — real data, real layout — and differ from
 * the previous set on every screen showing a date, for a reason nobody can see by looking. The only way to notice is
 * to check, so the run checks.
 */
test('refuses a build whose clock was not pinned', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/problems/prb-checkout-5xx');
  await expect(page.getByTestId('problem-title')).toBeVisible();
  await settle(page);

  const shown = await page.locator('body').innerText();
  // The app formats dates in the capture's language, so the expected string has to be in it too.
  const expected = new Date(SCREENSHOT_INSTANT).toLocaleString(LOCALE, { month: 'short', day: 'numeric' });
  expect(
    shown,
    `This build's clock is live, not pinned to ${expected}. Run "npm run store:capture", which exports with ` +
      'EXPO_PUBLIC_SCREENSHOT_AT set — "store:web" on its own photographs whatever dist-web happens to contain.',
  ).toContain(expected);
});
