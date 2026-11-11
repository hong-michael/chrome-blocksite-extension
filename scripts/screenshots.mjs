// Cross-platform wrapper: run the screenshot spec with SCREENSHOTS=1.
import { spawnSync } from 'node:child_process';

const res = spawnSync('npx', ['playwright', 'test', 'tests/e2e/screenshots.spec.js'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, SCREENSHOTS: '1' },
});
process.exit(res.status ?? 1);
