// Generates Chrome Web Store screenshots (1280×800) into store/screenshots/.
// Skipped unless SCREENSHOTS=1 (see `npm run screenshots`).
import { expect, test } from './fixtures.js';

const OUT = 'store/screenshots';
const SIZE = { width: 1280, height: 800 };
const MIN = 60000;

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to generate store screenshots');

const rule = (type, value, enabled = true) => ({ id: `${type}-${value}`, type, value, enabled, createdAt: 0 });

function fakeStats() {
  const stats = {};
  const hosts = { 'youtube.com': 9, 'reddit.com': 6, 'x.com': 4, 'instagram.com': 3, 'news.ycombinator.com': 2 };
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    stats[key] = Object.fromEntries(Object.entries(hosts).map(([h, n]) => [h, Math.max(0, Math.round(n * (0.4 + ((i * 7 + h.length) % 10) / 10)))]));
  }
  return stats;
}

/** Wait for the page's content and entrance animation. */
async function settled(page) {
  await expect(page.locator('h1')).toBeVisible();
  await page.waitForTimeout(600);
}

async function seed(ext) {
  await ext.setState({
    rules: [
      rule('domain', 'youtube.com'),
      rule('path', 'reddit.com/r/all'),
      rule('domain', 'x.com'),
      rule('domain', 'instagram.com'),
      rule('domain', 'tiktok.com'),
      rule('keyword', 'casino'),
      rule('domain', 'netflix.com', false),
    ],
    stats: fakeStats(),
  });
}

for (const scheme of ['light', 'dark']) {
  test(`store screenshots (${scheme})`, async ({ context, ext, server }) => {
    await seed(ext);
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(SIZE);

    await page.goto(ext.url('pages/options/options.html#blocklist'));
    await expect(page.locator('.rule')).toHaveCount(7);
    await page.screenshot({ path: `${OUT}/${scheme}-1-sites.png` });

    await page.goto(ext.url('pages/options/options.html#stats'));
    await settled(page);
    await page.screenshot({ path: `${OUT}/${scheme}-2-stats.png` });

    await page.goto(ext.url('pages/options/options.html#schedule'));
    await settled(page);
    await page.screenshot({ path: `${OUT}/${scheme}-3-schedule.png` });

    await page.goto(ext.url('pages/options/options.html#focus'));
    await settled(page);
    await page.screenshot({ path: `${OUT}/${scheme}-4-focus.png` });

    await page.goto(server.url('youtube.com', '/watch'));
    await expect(page).toHaveURL(new RegExp(`^${ext.blockPagePrefix}`));
    await settled(page);
    await page.screenshot({ path: `${OUT}/${scheme}-5-blocked.png` });

    // Popup states, shown at real popup size.
    const popup = await context.newPage();
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.setViewportSize({ width: 360, height: 560 });
    await popup.goto(ext.url('pages/popup/popup.html'));
    await popup.screenshot({ path: `${OUT}/${scheme}-popup-idle.png` });
    await ext.setState({ focus: { startedAt: Date.now() - 7 * MIN, endsAt: Date.now() + 18 * MIN } });
    await expect(popup.locator('.countdown')).toBeVisible();
    await popup.screenshot({ path: `${OUT}/${scheme}-popup-focus.png` });

    await page.goto(server.url('reddit.com', '/r/all'));
    await settled(page);
    await page.screenshot({ path: `${OUT}/${scheme}-6-blocked-focus.png` });
  });
}
