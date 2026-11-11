// Render src/icons/icon.svg to the PNG sizes the manifest needs, using Playwright's Chromium.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const iconsDir = fileURLToPath(new URL('../src/icons/', import.meta.url));
const svg = await readFile(`${iconsDir}icon.svg`, 'utf8');
// Small sizes get a little more stroke weight so the mark stays legible.
const SIZES = { 16: 12, 32: 10, 48: 9, 128: 9 };

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [size, stroke] of Object.entries(SIZES)) {
  const markup = svg.replaceAll('stroke-width="9"', `stroke-width="${stroke}"`).replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: Number(size), height: Number(size) });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
  await page.locator('svg').screenshot({ path: `${iconsDir}icon${size}.png`, omitBackground: true });
  console.log(`icons/icon${size}.png`);
}
await browser.close();
