import { expect, test } from './fixtures.js';

test.describe('options page', () => {
  test('add, toggle and remove sites', async ({ context, ext, server }) => {
    const page = await context.newPage();
    await page.goto(ext.url('pages/options/options.html#blocklist'));
    const input = page.getByLabel('Site, page or keyword to block');

    await input.fill('https://www.Blocked.test/anything');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('.rule')).toHaveCount(1);
    await expect(page.locator('.rule-value')).toContainText('blocked.test/anything');
    await expect(page.locator('.rule-value .tag')).toHaveText('Page');

    await input.fill('blocked.test');
    await input.press('Enter');
    await expect(page.locator('.rule')).toHaveCount(2);
    await expect(input).toHaveValue('');

    await input.fill('blocked.test');
    await input.press('Enter');
    await expect(page.getByText('blocked.test is already on your list.')).toBeVisible();

    await input.fill('not a valid thing');
    await input.press('Enter');
    await expect(input).toHaveAttribute('aria-invalid', 'true');

    // The rule really blocks.
    const site = await context.newPage();
    await site.goto(server.url('blocked.test'));
    await expect(site).toHaveURL(new RegExp(`^${ext.blockPagePrefix}`));

    // Disable it → unblocked.
    await page.getByRole('switch', { name: 'Disable blocked.test', exact: true }).click();
    await expect.poll(async () => JSON.stringify(await ext.dnrRules())).not.toContain('"blocked.test"');
    await site.goto(server.url('blocked.test'));
    await expect(site.locator('#where')).toHaveText('blocked.test/');

    await page.getByRole('button', { name: 'Remove blocked.test', exact: true }).click();
    await expect(page.locator('.rule')).toHaveCount(1);
  });

  test('bulk add and suggestions', async ({ context, ext }) => {
    const page = await context.newPage();
    await page.goto(ext.url('pages/options/options.html'));
    await page.getByRole('button', { name: 'Add several at once' }).click();
    await page.getByLabel('Sites to add, one per line').fill('a.test\nb.test, c.test/x\nbad entry\nkw');
    await page.getByRole('button', { name: 'Add all' }).click();
    await expect(page.locator('.rule')).toHaveCount(4);
    await expect(page.getByLabel('Sites to add, one per line')).toHaveValue('bad entry');

    await page.locator('.suggestions .chip', { hasText: 'reddit.com' }).click();
    await expect(page.locator('.rule').first()).toContainText('reddit.com');
    await expect(page.locator('.suggestions .chip', { hasText: 'reddit.com' })).toHaveCount(0);
  });

  test('welcome card on first install', async ({ context, ext }) => {
    const page = await context.newPage();
    await page.goto(ext.url('pages/options/options.html#welcome'));
    await expect(page.getByRole('heading', { name: 'Welcome to Focusgate' })).toBeVisible();
    await expect(page).toHaveURL(/#blocklist$/);
  });

  test('schedule editing persists and drives the effective state', async ({ context, ext }) => {
    const page = await context.newPage();
    await page.goto(ext.url('pages/options/options.html#schedule'));
    await page.getByRole('switch', { name: 'Use schedule' }).click();
    await expect.poll(async () => (await ext.getState()).schedule.enabled).toBe(true);

    await page.getByRole('button', { name: 'Saturday' }).first().click();
    await expect.poll(async () => (await ext.getState()).schedule.windows[0].days).toEqual([1, 2, 3, 4, 5, 6]);

    await page.getByRole('button', { name: 'Add time window' }).click();
    await expect(page.locator('.window')).toHaveCount(2);
    await page.getByLabel('From').nth(1).fill('22:00');
    await page.getByLabel('To').nth(1).fill('02:00');
    await page.getByLabel('To').nth(1).blur();
    await expect.poll(async () => (await ext.getState()).schedule.windows[1]).toMatchObject({ start: '22:00', end: '02:00' });
    await expect(page.getByText('ends next day')).toBeVisible();
  });

  test('focus lock disables loosening controls', async ({ context, ext }) => {
    await ext.addRule('domain', 'blocked.test');
    await ext.setState({ focus: { startedAt: Date.now(), endsAt: Date.now() + 10 * 60000 } });
    const page = await context.newPage();
    await page.goto(ext.url('pages/options/options.html'));
    await expect(page.getByText(/settings that loosen blocking are locked/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove blocked.test' })).toBeDisabled();
    await expect(page.getByRole('switch', { name: 'Disable blocked.test', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Allow list/ })).toBeDisabled();
    // Adding is still allowed.
    await page.getByLabel('Site, page or keyword to block').fill('more.test');
    await page.getByLabel('Site, page or keyword to block').press('Enter');
    await expect(page.locator('.rule')).toHaveCount(2);
  });

  test('statistics show recorded blocks', async ({ context, ext, server }) => {
    await ext.addRule('domain', 'blocked.test');
    const site = await context.newPage();
    for (let i = 0; i < 3; i++) {
      await site.goto(server.url('blocked.test', `/${i}`));
      await expect(site).toHaveURL(new RegExp(`^${ext.blockPagePrefix}`));
    }
    await expect(site.getByText('You’ve tried to open this site 3 times today.')).toBeVisible();

    const page = await context.newPage();
    await page.goto(ext.url('pages/options/options.html#stats'));
    await expect(page.locator('.tile').first()).toContainText('3');
    await expect(page.locator('.top-site')).toContainText('blocked.test');
  });

  test('import a backup (merge)', async ({ context, ext }) => {
    const page = await context.newPage();
    await page.goto(ext.url('pages/options/options.html#backup'));
    const backup = {
      app: 'focusgate',
      schemaVersion: 2,
      data: { rules: [{ type: 'domain', value: 'imported.test' }, { type: 'keyword', value: 'poker' }] },
    };
    await page.getByLabel('Backup file').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await expect(page.getByText('Imported 2 blocked and 0 allowed sites')).toBeVisible();
    await expect.poll(async () => (await ext.getState()).rules.map((r) => r.value).sort()).toEqual(['imported.test', 'poker']);
  });

  test('theme switch applies immediately', async ({ context, ext }) => {
    const page = await context.newPage();
    await page.goto(ext.url('pages/options/options.html#general'));
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'System' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  });
});

test.describe('popup', () => {
  test('start a focus session; locked controls; badge shows minutes', async ({ context, ext, sw }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 600 });
    await page.goto(ext.url('pages/popup/popup.html'));
    await expect(page.getByText('Blocking is on')).toBeVisible();

    await page.getByRole('button', { name: '50 minutes' }).click();
    await page.getByRole('button', { name: 'Start 50 min focus' }).click();
    await expect(page.locator('.countdown')).toHaveText(/^(50:00|49:5\d)$/);
    await expect(page.getByRole('button', { name: 'End session early' })).toBeDisabled();
    await expect(page.getByText('Settings are locked until the session ends')).toBeVisible();
    await expect.poll(() => sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('50m');
  });

  test('pause and resume', async ({ context, ext, server, sw }) => {
    await ext.addRule('domain', 'blocked.test');
    const page = await context.newPage();
    await page.goto(ext.url('pages/popup/popup.html'));
    await page.getByRole('button', { name: '15 min' }).click();
    await expect(page.locator('.status-title')).toHaveText('Paused');
    await expect.poll(async () => (await ext.dnrRules()).length).toBe(0);
    await expect.poll(() => sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('II');

    const site = await context.newPage();
    await site.goto(server.url('blocked.test'));
    await expect(site.locator('#where')).toHaveText('blocked.test/');

    await page.bringToFront();
    await page.getByRole('button', { name: 'Resume blocking now' }).click();
    await expect(page.locator('.status-title')).toHaveText('Blocking is on');
    // Resuming re-blocks the open tab.
    await expect(site).toHaveURL(new RegExp(`^${ext.blockPagePrefix}`));
  });

  test('master switch', async ({ context, ext, sw }) => {
    const page = await context.newPage();
    await page.goto(ext.url('pages/popup/popup.html'));
    await page.getByRole('switch', { name: 'Blocking enabled' }).click();
    await expect(page.locator('.status-title')).toHaveText('Blocking is off');
    await expect.poll(() => sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('OFF');
  });
});

test.describe('block page', () => {
  test('temporary access after the friction delay, then re-blocked when it expires', async ({ context, ext, server }) => {
    await ext.addRule('domain', 'blocked.test');
    await ext.setState({ settings: { tempAccess: { enabled: true, delaySeconds: 2, minutes: 1 } } });
    const page = await context.newPage();
    await page.goto(server.url('blocked.test', '/article'));
    await expect(page).toHaveURL(new RegExp(`^${ext.blockPagePrefix}`));

    await page.getByRole('button', { name: 'Allow for 1 min' }).click();
    await expect(page.getByRole('button', { name: /Take a breath/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Open for 1 min' }).click({ timeout: 5000 });
    await expect(page.locator('#where')).toHaveText('blocked.test/article');

    // Expire the grant: the worker re-blocks the open tab.
    await ext.setState({ tempAccess: [{ host: 'blocked.test', until: Date.now() - 1 }] });
    await expect(page).toHaveURL(new RegExp(`^${ext.blockPagePrefix}`));
  });

  test('no temporary access during a focus session; custom message shown', async ({ context, ext, server }) => {
    await ext.addRule('domain', 'blocked.test');
    await ext.setState({
      focus: { startedAt: Date.now(), endsAt: Date.now() + 5 * 60000 },
      settings: { blockPage: { message: 'Finish the thesis first.', showQuote: true, showStats: true } },
    });
    const page = await context.newPage();
    await page.goto(server.url('blocked.test'));
    await expect(page.getByText(/Focus session · \d:\d\d left/)).toBeVisible();
    await expect(page.getByText('Finish the thesis first.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Allow for/ })).toHaveCount(0);
  });

  test('offers to continue once the site is unblocked', async ({ context, ext, server }) => {
    await ext.addRule('domain', 'blocked.test');
    const page = await context.newPage();
    await page.goto(server.url('blocked.test', '/x'));
    await expect(page).toHaveURL(new RegExp(`^${ext.blockPagePrefix}`));
    await ext.setState({ pause: { until: Date.now() + 60000 } });
    await expect(page.getByText('Blocking is paused')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to site' }).click();
    await expect(page.locator('#where')).toHaveText('blocked.test/x');
  });

  test('renders safely with hostile URLs', async ({ context, ext }) => {
    const page = await context.newPage();
    await page.goto(`${ext.blockPagePrefix}?preview=1#https://example.com/<img src=x onerror=alert(1)>`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('example.com is blocked');
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });
});
