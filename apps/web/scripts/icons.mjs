/**
 * Asset pipeline: art/raw (gitignored dump zone) → public/icons + public/art.
 * Rerunnable; the committed outputs are DERIVED — regenerate here, never hand-edit.
 *
 * What it does, and why (art/raw/MANIFEST.md is the input's provenance):
 *  - The raw Recraft SVG bakes WHITE corner shapes outside its rounded square; under
 *    Android launcher masks and dark UIs those corners show. The ink background path is
 *    already full-bleed, so the fix is dropping the white paths. The icon ladder is
 *    re-rasterised from the CLEANED vector — the raw PNGs carry the same white corners.
 *  - All generator metadata (C2PA provenance, XMP) is stripped: the cleaned SVG by
 *    removing <metadata>, the rasters because sharp does not copy source metadata.
 *    (Pre-publication sweep discipline, repo CLAUDE.md — applied at derivation time.)
 *  - Illustrations ship as WebP at capped sizes: 2k PNGs are 3–4 MB each, far past the
 *    perf budget for a low-end-Android PWA; flat art compresses to a few % in WebP.
 *
 * Run from apps/web:  node scripts/icons.mjs
 */
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const RAW = join(WEB, '..', '..', 'art', 'raw');
const ICONS = join(WEB, 'public', 'icons');
const ART = join(WEB, 'public', 'art');
mkdirSync(ICONS, { recursive: true });
mkdirSync(ART, { recursive: true });

const emitted = [];
const emit = (path) => emitted.push([path.replace(WEB, ''), Math.round(statSync(path).size / 1024)]);

// ---- 1. the icon vector, cleaned -------------------------------------------------
const rawSvg = readFileSync(join(RAW, 'icon', 'app-icon.svg'), 'utf8');
const cleaned = rawSvg
  .replace(/<metadata>[\s\S]*?<\/metadata>/, '') // C2PA/XMP provenance blob
  .replace(/<path[^>]*fill="rgb\(255,254,254\)"[^>]*\/>/g, '') // the white corners
  .replace(/\s*preserveAspectRatio="none"/, '');
if (/255,254,254|<metadata>/.test(cleaned)) throw new Error('SVG cleanup left residue');
const svgPath = join(ICONS, 'app-icon.svg');
writeFileSync(svgPath, cleaned);
emit(svgPath);

// ---- 2. the raster ladder, from the cleaned vector -------------------------------
const svgBuf = Buffer.from(cleaned);
const png = (size) => sharp(svgBuf, { density: 300 }).resize(size, size).png().toBuffer();
for (const [size, name] of [[512, 'icon-512.png'], [192, 'icon-192.png'], [180, 'apple-touch-180.png']]) {
  const out = join(ICONS, name);
  writeFileSync(out, await png(size));
  emit(out);
}

// ---- 3. favicon.ico (multi-res 48/32/16), served from the site root --------------
const icoPath = join(WEB, 'public', 'favicon.ico');
writeFileSync(icoPath, await pngToIco([await png(48), await png(32), await png(16)]));
emit(icoPath);

// ---- 4. illustrations → capped WebP ----------------------------------------------
// Item files are named by their ItemKind id, so the UI can map kind → /art/item-<kind>.webp.
const ART_JOBS = [
  ['mascot-master.png', 'mascot.webp', 1024],
  ['ftue-onboarding.png', 'ftue-onboarding.webp', 1024],
  ['item-terminal-mk1.png', 'item-terminal_mk1.webp', 512],
  ['item-signal-booster.png', 'item-signal_booster.webp', 512],
  ['empty-state-after-hours.png', 'empty-after-hours.webp', 1024],
  ['state-nicked.png', 'state-nicked.webp', 1024],
];
for (const [src, dest, width] of ART_JOBS) {
  const out = join(ART, dest);
  await sharp(join(RAW, src)).resize({ width }).webp({ quality: 85 }).toFile(out);
  emit(out);
}

for (const [path, kb] of emitted) console.log(`${String(kb).padStart(5)} KB  ${path}`);
console.log(`\n${emitted.length} assets emitted.`);
