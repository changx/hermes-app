// Generates Hermes App icon assets from square source images in this folder.
// sharp is not a repo dependency; point SHARP_MODULE at any installed copy.
// Usage (from the repo root): SHARP_MODULE=/path/to/node_modules/sharp node assets/app-icon/generate.mjs
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || 'sharp');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const mobile = resolve(repo, 'apps/mobile/assets');
const desktop = resolve(repo, 'apps/desktop/resources');

// fgScale: Android adaptive foreground scale. It must keep every subject pixel inside the 72dp visible
// circle; the script measures the largest such scale and refuses a larger one.
// background: 'corners' = bilinear gradient from the source corners (smooth light backgrounds);
// 'blur' = the scaled source, edge-extended and strongly blurred (gradients the corners cannot describe).
const ICONS = [
  { id: 'mochi', source: 'mochi-wings-source.png', fgScale: 0.70, background: 'corners', primary: true },
  { id: 'bubble', source: 'bubble-source.png', fgScale: 0.70, background: 'blur' },
  { id: 'orb', source: 'orb-source.png', fgScale: 0.68, background: 'blur' },
];

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const rounded = (size, radius) => Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);

/** Largest scale (2% steps) at which no subject pixel falls outside the visible circle (r = 1/3). */
function safeScale(data, width) {
  const at = (x, y) => { const i = (y * width + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  let maxRadius = 0;
  for (let y = 0; y < width; y += 2) {
    const left = at(2, y), right = at(width - 3, y);
    for (let x = 0; x < width; x += 2) {
      const pixel = at(x, y);
      const reference = left.map((value, k) => value + (right[k] - value) * x / width);
      if (Math.hypot(...pixel.map((value, k) => value - reference[k])) > 40) {
        maxRadius = Math.max(maxRadius, Math.hypot(x / width - 0.5, y / width - 0.5));
      }
    }
  }
  return Math.floor((1 / 3) / maxRadius * 50) / 50;
}

async function androidLayers(base, data, icon) {
  const size = Math.round(1024 * icon.fgScale / 2) * 2, offset = (1024 - size) / 2;
  const inset = Math.round(size * 0.049), radius = Math.round(size * 0.1955), blur = Math.round(size * 0.0265);
  const feather = Buffer.from(`<svg width="${size}" height="${size}"><defs><filter id="f"><feGaussianBlur stdDeviation="${blur}"/></filter></defs><rect x="${inset}" y="${inset}" width="${size - 2 * inset}" height="${size - 2 * inset}" rx="${radius}" fill="#fff" filter="url(#f)"/></svg>`);
  const scaled = await sharp(base).resize(size, size).toBuffer();
  const foreground = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: transparent } })
    .composite([{ input: await sharp(scaled).ensureAlpha().composite([{ input: feather, blend: 'dest-in' }]).png().toBuffer(), left: offset, top: offset }])
    .png().toBuffer();
  let background;
  if (icon.background === 'corners') {
    const at = (x, y) => { const i = (y * 1024 + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
    const avg = (x, y) => { const s = [0, 0, 0]; for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) at(x + dx, y + dy).forEach((v, k) => s[k] += v); return s.map(v => v / 64); };
    const [tl, tr, bl, br] = [avg(2, 2), avg(1014, 2), avg(2, 1014), avg(1014, 1014)];
    const raw = Buffer.alloc(1024 * 1024 * 3);
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
      const u = x / 1023, v = y / 1023, i = (y * 1024 + x) * 3;
      for (let k = 0; k < 3; k++) raw[i + k] = Math.round((tl[k] * (1 - u) + tr[k] * u) * (1 - v) + (bl[k] * (1 - u) + br[k] * u) * v);
    }
    background = await sharp(raw, { raw: { width: 1024, height: 1024, channels: 3 } }).png().toBuffer();
  } else {
    background = await sharp(scaled).extend({ top: offset, bottom: offset, left: offset, right: offset, extendWith: 'mirror' })
      .blur(60).removeAlpha().png().toBuffer();
  }
  return { foreground, background };
}

/** Apple macOS template: 824x824 rounded body on a 1024 transparent canvas with a soft shadow. */
async function macTemplate(base) {
  const body = 824, inset = 100, radius = 185;
  const tile = await sharp(base).resize(body, body).ensureAlpha().composite([{ input: rounded(body, radius), blend: 'dest-in' }]).png().toBuffer();
  const shadow = Buffer.from(`<svg width="1024" height="1024"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter></defs><rect x="${inset}" y="${inset + 12}" width="${body}" height="${body}" rx="${radius}" fill="#000" fill-opacity="0.28" filter="url(#s)"/></svg>`);
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background: transparent } })
    .composite([{ input: shadow }, { input: tile, left: inset, top: inset }]).png().toBuffer();
}

async function icns(mac1024) {
  const entries = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  const chunks = [];
  for (const [type, size] of entries) {
    const png = await sharp(mac1024).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
    const head = Buffer.alloc(8); head.write(type, 0, 'ascii'); head.writeUInt32BE(png.length + 8, 4);
    chunks.push(head, png);
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8); header.write('icns', 0, 'ascii'); header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

await mkdir(resolve(mobile, 'app-icons'), { recursive: true });
await mkdir(resolve(desktop, 'app-icons'), { recursive: true });
for (const icon of ICONS) {
  const base = await sharp(resolve(here, icon.source)).removeAlpha().resize(1024, 1024, { kernel: 'lanczos3' }).png().toBuffer();
  const { data } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
  const measured = safeScale(data, 1024);
  console.log(`${icon.id}: android fgScale ${icon.fgScale}, largest safe scale ${measured}`);
  if (icon.fgScale > measured) throw new Error(`${icon.id}: fgScale ${icon.fgScale} cuts the subject; use <= ${measured}`);
  const { foreground, background } = await androidLayers(base, data, icon);
  const mac = await macTemplate(base);
  // Settings picker thumbnail (both apps show it with rounded corners).
  await sharp(base).resize(180, 180).png({ compressionLevel: 9 }).toFile(resolve(mobile, `app-icons/${icon.id}-thumb.png`));
  // Desktop Dock image for runtime switching, also the desktop Settings thumbnail.
  await sharp(mac).resize(512, 512, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(resolve(desktop, `app-icons/${icon.id}.png`));
  if (icon.primary) {
    // Default icon: Expo `icon`, Android `adaptiveIcon` and the packaged macOS bundle icon.
    await sharp(base).png({ compressionLevel: 9 }).toFile(resolve(mobile, 'icon.png'));
    await writeFile(resolve(mobile, 'adaptive-foreground.png'), foreground);
    await writeFile(resolve(mobile, 'adaptive-background.png'), background);
    await sharp(mac).png({ compressionLevel: 9 }).toFile(resolve(desktop, 'icon.png'));
    await writeFile(resolve(desktop, 'icon.icns'), await icns(mac));
  } else {
    // Alternate icon for expo-alternate-app-icons (iOS: opaque 1024; Android: adaptive layers).
    await sharp(base).png({ compressionLevel: 9 }).toFile(resolve(mobile, `app-icons/${icon.id}.png`));
    await writeFile(resolve(mobile, `app-icons/${icon.id}-foreground.png`), foreground);
    await writeFile(resolve(mobile, `app-icons/${icon.id}-background.png`), background);
  }
}
