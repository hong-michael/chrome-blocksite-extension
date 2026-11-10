// Zip src/ into dist/focusgate-<version>.zip for upload to the Chrome Web Store.
// Dependency-free: writes a standard deflate ZIP with node:zlib.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'src');
const manifest = JSON.parse(await readFile(join(srcDir, 'manifest.json'), 'utf8'));
// Source-only files that don't need to ship.
const EXCLUDE = [/^icons\/icon\.svg$/, /(^|\/)\./];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const files = (await walk(srcDir))
  .map((full) => ({ full, name: relative(srcDir, full).split(sep).join('/') }))
  .filter((f) => !EXCLUDE.some((re) => re.test(f.name)))
  .sort((a, b) => a.name.localeCompare(b.name));

const { time, day } = dosTime(new Date());
const locals = [];
const centrals = [];
let offset = 0;
for (const f of files) {
  const data = await readFile(f.full);
  const compressed = deflateRawSync(data, { level: 9 });
  const name = Buffer.from(f.name, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(day, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + compressed.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

await mkdir(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', `focusgate-${manifest.version}.zip`);
await writeFile(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`${relative(root, out)} — ${files.length} files`);
