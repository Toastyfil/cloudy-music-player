// Renders Cloudy's icon — a clean white cloud on a black rounded square — at any
// resolution, with no image library: geometry is rasterised by hand, PNGs are
// encoded here, and the .ico is assembled as a multi-size PNG container.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(process.cwd(), 'build');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;

/** Signed distance to a rounded rectangle. */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

// --- cloud geometry, authored in a 512×512 space -------------------------
// The same construction as the in-app mark (a 24×24 cloud path): one large
// dome, one smaller right puff, and a base that joins their bottoms into a
// single flat edge. Proportions are the path's own, scaled by 17 and centred.
const DOME = { cx: 205, cy: 256, r: 119 };
const PUFF = { cx: 349.5, cy: 298.5, r: 76.5 };
const BASE = { cx: 277.25, cy: 324, hw: 72.25, hh: 51, r: 8 };
const PLATE_RADIUS = 104;
const BG = [11, 12, 14];
const CLOUD = [255, 255, 255];

/** Anti-aliased coverage of a disc. */
function discCoverage(x, y, cx, cy, radius) {
  return clamp01(radius - Math.hypot(x - cx, y - cy) + 0.5);
}

/** RGBA pixels for a square icon of `size` px, edges anti-aliased. */
function render(size) {
  const k = size / 512;
  const pixels = Buffer.alloc(size * size * 4);
  const dome = { cx: DOME.cx * k, cy: DOME.cy * k, r: DOME.r * k };
  const puff = { cx: PUFF.cx * k, cy: PUFF.cy * k, r: PUFF.r * k };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      let coverage = discCoverage(px, py, dome.cx, dome.cy, dome.r);
      coverage = Math.max(coverage, discCoverage(px, py, puff.cx, puff.cy, puff.r));
      // The base bar's top edge sits inside both discs, so it merges into the
      // silhouette without a seam while giving the cloud a flat bottom.
      coverage = Math.max(
        coverage,
        clamp01(0.5 - sdRoundRect(px, py, BASE.cx * k, BASE.cy * k, BASE.hw * k, BASE.hh * k, BASE.r * k)),
      );

      const plate = clamp01(
        0.5 - sdRoundRect(px, py, size / 2, size / 2, size / 2, size / 2, PLATE_RADIUS * k),
      );
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(mix(BG[0], CLOUD[0], coverage));
      pixels[offset + 1] = Math.round(mix(BG[1], CLOUD[1], coverage));
      pixels[offset + 2] = Math.round(mix(BG[2], CLOUD[2], coverage));
      pixels[offset + 3] = Math.round(plate * 255);
    }
  }
  return pixels;
}

// --- minimal PNG encoder -------------------------------------------------
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
};

function encodePng(size, pixels) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pngAt = (size) => encodePng(size, render(size));

// --- multi-resolution .ico (PNG-compressed frames, Vista and later) ------
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function encodeIco(sizes) {
  const frames = sizes.map((size) => ({ size, data: pngAt(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);

  const entries = Buffer.alloc(16 * frames.length);
  let offset = header.length + entries.length;
  frames.forEach((frame, i) => {
    const at = i * 16;
    entries[at] = frame.size >= 256 ? 0 : frame.size; // 0 means 256
    entries[at + 1] = frame.size >= 256 ? 0 : frame.size;
    entries[at + 2] = 0; // palette colours
    entries[at + 3] = 0; // reserved
    entries.writeUInt16LE(1, at + 4); // colour planes
    entries.writeUInt16LE(32, at + 6); // bits per pixel
    entries.writeUInt32BE(0, at + 8);
    entries.writeUInt32LE(frame.data.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += frame.data.length;
  });

  return Buffer.concat([header, entries, ...frames.map((frame) => frame.data)]);
}

const icon = pngAt(512);
fs.writeFileSync(path.join(out, 'icon.png'), icon);
fs.writeFileSync(path.join(out, 'icons', '512x512.png'), icon);
fs.writeFileSync(path.join(out, 'splash.png'), icon);
fs.writeFileSync(path.join(out, 'icon.ico'), encodeIco(ICO_SIZES));

console.log(
  `wrote build/icon.png (512), build/icons/512x512.png, build/splash.png, build/icon.ico (${ICO_SIZES.join(', ')})`,
);
