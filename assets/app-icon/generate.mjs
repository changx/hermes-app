// Generates Hermes App icon assets from one square source image.
// sharp is not a repo dependency; point SHARP_MODULE at any installed copy.
// Usage: SHARP_MODULE=/path/to/node_modules/sharp node assets/app-icon/generate.mjs assets/app-icon/mochi-wings-source.png .
import { createRequire } from 'node:module';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || 'sharp');

const [src, repo] = process.argv.slice(2);
const brand = resolve(repo, 'assets/app-icon');
const mobile = resolve(repo, 'apps/mobile/assets');
const desktop = resolve(repo, 'apps/desktop/resources');
await mkdir(brand, { recursive: true });
const sourceCopy = resolve(brand, 'mochi-wings-source.png');
if (resolve(src) !== sourceCopy) await copyFile(src, sourceCopy);
for (const d of [mobile, desktop]) await mkdir(d, { recursive: true });

const base = await sharp(src).removeAlpha().resize(1024, 1024, { kernel: 'lanczos3' }).png().toBuffer();

// iOS / Expo default icon: opaque 1024 square; iOS applies its own mask.
await sharp(base).png({ compressionLevel: 9 }).toFile(resolve(mobile, 'icon.png'));

// Android adaptive icon (1024 = 108dp). Background: bilinear gradient from the source corners.
// Foreground: the source scaled to 0.70 with feathered edges. At 0.70 no subject pixel falls outside the
// 72dp visible circle (measured: 0.80 cut ~2% of the wing tips on round launchers).
const { data, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
const at = (x, y) => { const i = (y * info.width + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
const avg = (x, y) => { const s = [0, 0, 0]; for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) at(x + dx, y + dy).forEach((v, k) => s[k] += v); return s.map(v => v / 64); };
const [tl, tr, bl, br] = [avg(2, 2), avg(1014, 2), avg(2, 1014), avg(1014, 1014)];
const bg = Buffer.alloc(1024 * 1024 * 3);
for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
  const u = x / 1023, v = y / 1023, i = (y * 1024 + x) * 3;
  for (let k = 0; k < 3; k++) bg[i + k] = Math.round((tl[k] * (1 - u) + tr[k] * u) * (1 - v) + (bl[k] * (1 - u) + br[k] * u) * v);
}
await sharp(bg, { raw: { width: 1024, height: 1024, channels: 3 } }).png().toFile(resolve(mobile, 'adaptive-background.png'));
const fgSize = 716, off = (1024 - fgSize) / 2;
const feather = Buffer.from(`<svg width="${fgSize}" height="${fgSize}"><defs><filter id="f"><feGaussianBlur stdDeviation="19"/></filter></defs><rect x="35" y="35" width="${fgSize - 70}" height="${fgSize - 70}" rx="140" fill="#fff" filter="url(#f)"/></svg>`);
const fg = await sharp(base).resize(fgSize, fgSize).ensureAlpha().composite([{ input: feather, blend: 'dest-in' }]).png().toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: fg, left: off, top: off }]).png().toFile(resolve(mobile, 'adaptive-foreground.png'));

// macOS: Apple template, 824x824 rounded body on a 1024 transparent canvas with a soft shadow.
const body = 824, inset = 100, radius = 185;
const mask = Buffer.from(`<svg width="${body}" height="${body}"><rect width="${body}" height="${body}" rx="${radius}" fill="#fff"/></svg>`);
const tile = await sharp(base).resize(body, body).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
const shadow = Buffer.from(`<svg width="1024" height="1024"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter></defs><rect x="${inset}" y="${inset + 12}" width="${body}" height="${body}" rx="${radius}" fill="#000" fill-opacity="0.28" filter="url(#s)"/></svg>`);
const mac1024 = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: shadow }, { input: tile, left: inset, top: inset }]).png().toBuffer();
await sharp(mac1024).png({ compressionLevel: 9 }).toFile(resolve(desktop, 'icon.png'));

// ICNS container with PNG payloads.
const entries = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
const chunks = [];
for (const [type, size] of entries) {
  const png = await sharp(mac1024).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
  const head = Buffer.alloc(8); head.write(type, 0, 'ascii'); head.writeUInt32BE(png.length + 8, 4);
  chunks.push(head, png);
}
const body8 = Buffer.concat(chunks);
const hdr = Buffer.alloc(8); hdr.write('icns', 0, 'ascii'); hdr.writeUInt32BE(body8.length + 8, 4);
await writeFile(resolve(desktop, 'icon.icns'), Buffer.concat([hdr, body8]));
console.log('corners', JSON.stringify([tl, tr, bl, br].map(c => c.map(Math.round))));
