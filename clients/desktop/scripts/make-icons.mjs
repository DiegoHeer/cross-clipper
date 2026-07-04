#!/usr/bin/env node
// Generates placeholder amber icons for the Tauri bundle.
// Emits: icons/32x32.png, icons/128x128.png, icons/icon.ico
// Placeholder art until design assets exist (desktop spec §10, LOC-exempt).
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "..", "icons");

const crcTable = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
// Amber: #d97706 = rgb(217, 119, 6)
const AMBER = [217, 119, 6];

const png = (size, [r, g, b]) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const row = Buffer.from([0, ...Array(size).fill([r, g, b]).flat()]);
  const raw = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// Minimal ICO: single 32x32 RGBA image (required by Windows, accepted by Tauri)
const ico = (size, [r, g, b]) => {
  // BITMAPINFOHEADER + pixel data for ICO
  const pixelCount = size * size;
  const bmpHeader = Buffer.alloc(40);
  bmpHeader.writeUInt32LE(40, 0);      // biSize
  bmpHeader.writeInt32LE(size, 4);     // biWidth
  bmpHeader.writeInt32LE(size * 2, 8); // biHeight (doubled for ICO XOR+AND masks)
  bmpHeader.writeUInt16LE(1, 12);      // biPlanes
  bmpHeader.writeUInt16LE(32, 14);     // biBitCount (BGRA)
  bmpHeader.writeUInt32LE(0, 16);      // biCompression
  bmpHeader.writeUInt32LE(pixelCount * 4, 20); // biSizeImage
  // XOR mask: BGRA pixels (bottom-to-top)
  const xorMask = Buffer.alloc(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    xorMask[i * 4 + 0] = b; // B
    xorMask[i * 4 + 1] = g; // G
    xorMask[i * 4 + 2] = r; // R
    xorMask[i * 4 + 3] = 255; // A
  }
  // AND mask: all opaque (0 bits = opaque)
  const andMaskRowBytes = Math.ceil(size / 32) * 4;
  const andMask = Buffer.alloc(andMaskRowBytes * size, 0);
  const bmpData = Buffer.concat([bmpHeader, xorMask, andMask]);

  // ICO header
  const icoHeader = Buffer.alloc(6 + 16); // ICONDIR + 1 ICONDIRENTRY
  icoHeader.writeUInt16LE(0, 0);  // idReserved
  icoHeader.writeUInt16LE(1, 2);  // idType = 1 (ICO)
  icoHeader.writeUInt16LE(1, 4);  // idCount
  // ICONDIRENTRY
  icoHeader[6] = size === 256 ? 0 : size;  // bWidth
  icoHeader[7] = size === 256 ? 0 : size;  // bHeight
  icoHeader[8] = 0;   // bColorCount
  icoHeader[9] = 0;   // bReserved
  icoHeader.writeUInt16LE(1, 10); // wPlanes
  icoHeader.writeUInt16LE(32, 12); // wBitCount
  icoHeader.writeUInt32LE(bmpData.length, 14); // dwBytesInRes
  icoHeader.writeUInt32LE(22, 18); // dwImageOffset (6 + 16)

  return Buffer.concat([icoHeader, bmpData]);
};

mkdirSync(iconsDir, { recursive: true });

for (const size of [32, 128]) {
  writeFileSync(join(iconsDir, `${size}x${size}.png`), png(size, AMBER));
}
writeFileSync(join(iconsDir, "icon.ico"), ico(32, AMBER));

console.log("Desktop icons written to icons/");
