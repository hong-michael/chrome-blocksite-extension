import { expect, test } from './fixtures.js';

test.describe('blocking', () => {
  test('a domain rule redirects the domain and its subdomains to the block page', async ({ context, ext, server }) => {
    await ext.addRule('domain', 'blocked.test');
    const page = await context.newPage();

    await page.goto(server.url('blocked.test', '/some/page?q=1'));
    await expect(page).toHaveURL(new RegExp(`^${ext.blockPagePrefix}#http://blocked\\.test:\\d+/some/page\\?q=1$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('blocked.test is blocked');
    await expect(page.getByText('On your block list')).toBeVisible();

    await page.goto(server.url('www.blocked.test'));
    await expect(page).toHaveURL(new RegExp(`^${ext.blockPagePrefix}`));

    // Not a substring match: notblocked.test is a different domain (v1 bug).
    await page.goto(server.url('notblocked.test'));
    await expect(page.locator('#where')).toHaveText('notblocked.test/');
  });

  test('path rules block only that section, including SPA navigations', async ({ context, ext, server }) => {
    await ext.addRule('path', 'videos.test/shorts');
    const page = await context.newPage();

    await page.goto(server.url('videos.test', '/shorts/123'));
    await expect(page).toHaveURL(new RegExp(`^${ext.blockPagePrefix}`));
    await expect(page.getByText('Blocked page: videos.test/shorts')).toBeVisible();

    await page.goto(server.url('videos.test', '/watch'));
    await expect(page.locator('#where')).toHaveText('videos.test/watch');

    // history.pushState never hits the network; the worker catches it via tabs.onUpdated.
    await page.click('#spa');
    await expect(page).toHaveURL(new RegExp(`^${ext.blockPagePrefix}#http://videos\\.test:\\d+/shorts/spa$`));
  });

  test('keyword rules match anywhere in the URL', async ({ context, ext, server }) => {
    await ext.addRule('keyword', 'casino');
    const page = await context.newPage();
    await page.goto(server.url('news.test', '/search?q=casino+night'));
    await expect(page).toHaveURL(new RegExp(`^${ext.blockPagePrefix}`));
    await expect(page.getByText('Blocked keyword: “casino”')).toBeVisible();
  });

  test('open tabs are redirected as soon as a site is blocked', async ({ context, ext, server }) => {
    const page = await context.newPage();
    await page.goto(server.url('later.test'));
    await expect(page.locator('#where')).toHaveText('later.test/');
    await ext.addRule('domain', 'later.test');
    await expect(page).toHaveURL(new RegExp(`^${ext.blockPagePrefix}#http://later\\.test`));
  });

  test('allow-list mode blocks everything except allowed sites', async ({ context, ext, server }) => {
    await ext.setState({
      settings: { mode: 'allow' },
      allowlist: [{ id: 'a', type: 'domain', value: 'work.test', enabled: true, createdAt: 0 }],
    });
    await expect.poll(async () => (await ext.dnrRules()).length).toBe(2);
    const page = await context.newPage();
    await page.goto(server.url('docs.work.test'));
    await expect(page.locator('#where')).toHaveText('docs.work.test/');
    await page.goto(server.url('fun.test'));
    await expect(page).toHaveURL(new RegExp(`^${ext.blockPagePrefix}`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('fun.test isn’t on your allow list');
  });

  test('turning blocking off removes all rules', async ({ context, ext, server }) => {
    await ext.addRule('domain', 'blocked.test');
    await ext.setState({ settings: { enabled: false } });
    await expect.poll(async () => (await ext.dnrRules()).length).toBe(0);
    const page = await context.newPage();
    await page.goto(server.url('blocked.test'));
    await expect(page.locator('#where')).toHaveText('blocked.test/');
  });
});
