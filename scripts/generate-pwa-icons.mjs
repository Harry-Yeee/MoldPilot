/**
 * Generate MoldPilot PWA monogram icons as real PNG files with no dependencies.
 *
 * Draws a brand-blue rounded square (or full-bleed square for the maskable
 * variant) with a white "M" monogram, then encodes an 8-bit RGBA PNG using
 * only node:zlib. Re-run with `node scripts/generate-pwa-icons.mjs` after
 * changing brand colors.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BRAND = [0x1d, 0x4f, 0x91]; // brand-600 #1d4f91
const WHITE = [0xff, 0xff, 0xff];

function crc32(buffer) {
  let crc = ~0;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // no filter
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function setPixel(rgba, width, x, y, color, alpha = 255) {
  const offset = (y * width + x) * 4;
  rgba[offset] = color[0];
  rgba[offset + 1] = color[1];
  rgba[offset + 2] = color[2];
  rgba[offset + 3] = alpha;
}

function fillRect(rgba, width, x0, y0, x1, y1, color) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(rgba.length / 4 / width, Math.ceil(y1)); y += 1) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x += 1) {
      setPixel(rgba, width, x, y, color);
    }
  }
}

/** Draw a filled line of given thickness between two points. */
function drawThickLine(rgba, width, ax, ay, bx, by, thickness, color) {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
  const half = thickness / 2;
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const cx = ax + (bx - ax) * t;
    const cy = ay + (by - ay) * t;
    fillRect(rgba, width, cx - half, cy - half, cx + half, cy + half, color);
  }
}

function makeIcon(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  // Background.
  const inset = maskable ? 0 : Math.round(size * 0.06);
  const radius = maskable ? 0 : Math.round(size * 0.18);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const withinX = x >= inset && x < size - inset;
      const withinY = y >= inset && y < size - inset;
      if (!withinX || !withinY) {
        setPixel(rgba, size, x, y, BRAND, 0);
        continue;
      }
      // Rounded corners for the non-maskable icon.
      if (radius > 0) {
        const corners = [
          [inset + radius, inset + radius],
          [size - inset - radius, inset + radius],
          [inset + radius, size - inset - radius],
          [size - inset - radius, size - inset - radius]
        ];
        const nearX = x < inset + radius || x >= size - inset - radius;
        const nearY = y < inset + radius || y >= size - inset - radius;
        if (nearX && nearY) {
          const [cx, cy] = corners.reduce((best, corner) =>
            Math.hypot(x - corner[0], y - corner[1]) < Math.hypot(x - best[0], y - best[1]) ? corner : best
          );
          if (Math.hypot(x - cx, y - cy) > radius) {
            setPixel(rgba, size, x, y, BRAND, 0);
            continue;
          }
        }
      }
      setPixel(rgba, size, x, y, BRAND);
    }
  }

  // "M" monogram. Keep it inside the maskable safe zone (~80%).
  const safe = maskable ? size * 0.62 : size * 0.52;
  const left = (size - safe) / 2;
  const right = left + safe;
  const top = (size - safe) / 2;
  const bottom = top + safe;
  const thickness = Math.max(2, Math.round(size * 0.09));
  const mid = (left + right) / 2;
  drawThickLine(rgba, size, left, bottom, left, top, thickness, WHITE);
  drawThickLine(rgba, size, left, top, mid, bottom, thickness, WHITE);
  drawThickLine(rgba, size, mid, bottom, right, top, thickness, WHITE);
  drawThickLine(rgba, size, right, top, right, bottom, thickness, WHITE);

  return encodePng(size, size, rgba);
}

const iconsDir = path.join(process.cwd(), "public", "icons");
mkdirSync(iconsDir, { recursive: true });

writeFileSync(path.join(iconsDir, "icon-192.png"), makeIcon(192, { maskable: false }));
writeFileSync(path.join(iconsDir, "icon-512.png"), makeIcon(512, { maskable: false }));
writeFileSync(path.join(iconsDir, "icon-maskable-512.png"), makeIcon(512, { maskable: true }));
writeFileSync(path.join(process.cwd(), "public", "apple-touch-icon.png"), makeIcon(180, { maskable: false }));

console.log("Generated PWA icons in public/icons and public/apple-touch-icon.png");
