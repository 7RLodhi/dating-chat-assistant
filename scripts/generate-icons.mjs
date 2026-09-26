// Generates PWA icons with zero dependencies (hand-rolled PNG writer using
// built-in zlib). Run once with `node scripts/generate-icons.mjs`; commit the
// PNGs in public/icons/. Re-run only if the brand art changes.
// Design: brand-pink background, white chat bubble with three typing dots.

import { deflateSync } from "zlib";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

const BRAND = [219, 39, 119]; // #db2777
const WHITE = [255, 255, 255];

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(path, width, height, pixels) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter byte: none
    pixels.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", (() => {
      const b = Buffer.alloc(13);
      b.writeUInt32BE(width, 0);
      b.writeUInt32BE(height, 4);
      b[8] = 8; // bit depth
      b[9] = 6; // color type: RGBA
      return b;
    })()),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${width}x${height})`);
}

function inRoundedRect(px, py, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  const dx = px - cx;
  const dy = py - cy;
  const inside = px >= x0 && px <= x1 && py >= y0 && py <= y1;
  return inside && dx * dx + dy * dy <= r * r;
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
  const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
  const l3 = 1 - l1 - l2;
  return l1 >= 0 && l2 >= 0 && l3 >= 0;
}

// Draws the bubble art into a pixel buffer. `artScale` (0-1) controls how
// much of the canvas the art fills — maskable icons need art inside the
// central safe zone (~0.62), regular icons can go full-bleed (~0.78).
function drawIcon(size, artScale) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 512; // design in 512-space
  const cx = size / 2;
  const half = (256 * artScale * 2 * s) / 2;
  // Background
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = BRAND[0];
    buf[i * 4 + 1] = BRAND[1];
    buf[i * 4 + 2] = BRAND[2];
    buf[i * 4 + 3] = 255;
  }
  // Bubble geometry in 512-space, scaled about the center.
  const map = (v) => cx + (v - 256) * artScale * s;
  const x0 = map(106);
  const y0 = map(126);
  const x1 = map(406);
  const y1 = map(336);
  const r = 52 * artScale * s;
  void half;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inBubble = inRoundedRect(x, y, x0, y0, x1, y1, r);
      const inTail = inTriangle(x, y, map(150), map(320), map(120), map(420), map(230), map(330));
      if (inBubble || inTail) {
        const i = (y * size + x) * 4;
        buf[i] = WHITE[0];
        buf[i + 1] = WHITE[1];
        buf[i + 2] = WHITE[2];
      }
    }
  }
  // Three typing dots (brand color on the white bubble).
  const dotR = 22 * artScale * s;
  for (const dx of [-70, 0, 70]) {
    const dcx = map(256 + dx);
    const dcy = map(231);
    for (let y = Math.floor(dcy - dotR - 1); y <= Math.ceil(dcy + dotR + 1); y++) {
      for (let x = Math.floor(dcx - dotR - 1); x <= Math.ceil(dcx + dotR + 1); x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if ((x - dcx) ** 2 + (y - dcy) ** 2 <= dotR * dotR) {
          const i = (y * size + x) * 4;
          buf[i] = BRAND[0];
          buf[i + 1] = BRAND[1];
          buf[i + 2] = BRAND[2];
        }
      }
    }
  }
  return buf;
}

writePng(join(outDir, "icon-192.png"), 192, 192, drawIcon(192, 0.78));
writePng(join(outDir, "icon-512.png"), 512, 512, drawIcon(512, 0.78));
writePng(join(outDir, "maskable-512.png"), 512, 512, drawIcon(512, 0.62));
writePng(join(outDir, "apple-touch-icon.png"), 180, 180, drawIcon(180, 0.78));
writePng(join(outDir, "favicon-32.png"), 32, 32, drawIcon(32, 0.78));

// Android launcher mipmaps (same brand art) for webapp/android.
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(densities)) {
  const dir = join(root, "android", "app", "src", "main", "res", `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  writePng(join(dir, "ic_launcher.png"), size, size, drawIcon(size, 0.78));
}
