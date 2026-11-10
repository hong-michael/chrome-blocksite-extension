// Playwright fixtures: Chromium with the unpacked extension, a local HTTP server, and
// `*.test` hostnames resolved to it so domain rules can be exercised for real.
import { test as base, chromium, expect } from '@playwright/test';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const EXTENSION_PATH = fileURLToPath(new URL('../../src', import.meta.url));

function startServer() {
  const server = http.createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0];
    const path = req.url ?? '/';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>${host}${path}</title>
<h1 id="where">${host}${path}</h1>
<button id="spa" onclick="history.pushState({}, '', '/shorts/spa')">go to shorts</button>`);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

export const test = base.extend({
  // One server for the whole run.
  server: [
    async ({}, use) => {
      const server = await startServer();
      await use({ port: server.address().port, url: (host, path = '/') => `http://${host}:${server.address().port}${path}` });
      server.close();
    },
    { scope: 'worker' },
  ],

  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--host-resolver-rules=MAP *.test 127.0.0.1',
        '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable',
      ],
    });
    await use(context);
    await context.close();
  },

  sw: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    // Wait for onInstalled to finish initialising storage.
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('schemaVersion')).schemaVersion)).toBe(2);
    await use(worker);
  },

  extensionId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host);
  },

  ext: async ({ context, sw, extensionId }, use) => {
    const helpers = {
      id: extensionId,
      url: (path) => `chrome-extension://${extensionId}/${path}`,
      blockPagePrefix: `chrome-extension://${extensionId}/pages/blocked/blocked.html`,
      /** Merge values into chrome.storage.local (deep-merges `settings`). */
      async setState(patch) {
        await sw.evaluate(async (p) => {
          if (p.settings) {
            const { settings = {} } = await chrome.storage.local.get('settings');
            p.settings = { ...settings, ...p.settings };
          }
          await chrome.storage.local.set(p);
        }, patch);
      },
      async getState() {
        return sw.evaluate(() => chrome.storage.local.get(null));
      },
      async dnrRules() {
        return sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
      },
      /** Add a rule directly and wait for its DNR rule to be installed. */
      async addRule(type, value) {
        const before = (await helpers.dnrRules()).length;
        await sw.evaluate(
          async ([type, value]) => {
            const { rules = [] } = await chrome.storage.local.get('rules');
            rules.unshift({ id: crypto.randomUUID(), type, value, enabled: true, createdAt: Date.now() });
            await chrome.storage.local.set({ rules });
          },
          [type, value],
        );
        if (type !== 'domain' || before === 0) await expect.poll(async () => (await helpers.dnrRules()).length).toBeGreaterThan(before);
        else await expect.poll(async () => JSON.stringify(await helpers.dnrRules())).toContain(value);
      },
      /** Wait until the worker has settled (DNR rules reflect storage). */
      async settle() {
        await sw.evaluate(() => new Promise((r) => setTimeout(r, 150)));
      },
    };
    // Dismiss the onboarding tab opened on install so tests start clean.
    for (const p of context.pages()) if (p.url().includes('options.html')) await p.close();
    await use(helpers);
  },
});

export { expect };
