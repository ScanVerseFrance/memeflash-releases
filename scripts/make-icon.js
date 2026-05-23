'use strict';

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

// ── App icon (256×256 SVG → ICO) ─────────────────────────────────────────────
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e05a28"/>
      <stop offset="100%" stop-color="#9b2c0d"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="48" fill="url(#bg)"/>
  <rect x="34" y="48" width="38" height="162" rx="5" fill="white"/>
  <rect x="184" y="48" width="38" height="162" rx="5" fill="white"/>
  <polygon points="72,48 116,48 128,132 116,132" fill="white"/>
  <polygon points="184,48 140,48 128,132 140,132" fill="white"/>
  <rect x="110" y="116" width="36" height="94" rx="5" fill="white"/>
</svg>`;

// ── Installer header BMP (150×57) ─────────────────────────────────────────────
// Affiché en haut à gauche de chaque page de l'installateur
const HEADER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 57" width="150" height="57">
  <rect width="150" height="57" fill="#1a1a1a"/>
  <rect width="4" height="57" fill="#e05a28"/>
  <!-- M logo (polygon calculé à partir du logo 256px, mis à l'échelle 30×30 à x=10,y=13) -->
  <polygon points="12,44 12,14 19,14 27,29 35,14 42,14 42,44 37,44 37,27 31,37 23,37 17,27 17,44" fill="#e05a28"/>
  <text x="52" y="27" font-family="Arial Black,Arial,sans-serif" font-size="16" font-weight="900" fill="white">MemeFlash</text>
  <text x="52" y="43" font-family="Arial,sans-serif" font-size="10" fill="#e05a28">by MemeCorp</text>
</svg>`;

// ── Installer sidebar BMP (164×314) ──────────────────────────────────────────
// Affiché sur la page Bienvenue / Fin
const SIDEBAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164 314" width="164" height="314">
  <rect width="164" height="314" fill="#1a1a1a"/>
  <rect width="164" height="4" fill="#e05a28"/>
  <rect y="310" width="164" height="4" fill="#e05a28"/>
  <!-- Grand M centré (polygon calculé à partir du logo 256px, mis à l'échelle 120×115 à x=22,y=80) -->
  <polygon points="22,195 22,80 51,80 82,142 113,80 142,80 142,195 121,195 121,131 96,171 68,171 43,131 43,195" fill="#e05a28"/>
  <!-- Titre -->
  <text x="82" y="228" font-family="Arial Black,Arial,sans-serif" font-size="19" font-weight="900" fill="white" text-anchor="middle">MemeFlash</text>
  <text x="82" y="247" font-family="Arial,sans-serif" font-size="11" fill="#e05a28" text-anchor="middle">by MemeCorp</text>
  <!-- Version -->
  <text x="82" y="295" font-family="Arial,sans-serif" font-size="10" fill="#444" text-anchor="middle">v1.1.0</text>
</svg>`;

// ── ICO builder (multi-size PNG → .ico) ───────────────────────────────────────
function buildIco(pngBuffers) {
  const count   = pngBuffers.length;
  const dirSz   = 6 + 16 * count;
  let dataSz    = 0;
  const offsets = pngBuffers.map(b => { const o = dirSz + dataSz; dataSz += b.length; return o; });
  const out     = Buffer.alloc(dirSz + dataSz);
  out.writeUInt16LE(0, 0); out.writeUInt16LE(1, 2); out.writeUInt16LE(count, 4);
  pngBuffers.forEach((b, i) => {
    const e = 6 + i * 16;
    out.writeUInt8(0, e); out.writeUInt8(0, e+1); out.writeUInt8(0, e+2); out.writeUInt8(0, e+3);
    out.writeUInt16LE(1, e+4); out.writeUInt16LE(32, e+6);
    out.writeUInt32LE(b.length, e+8); out.writeUInt32LE(offsets[i], e+12);
    b.copy(out, offsets[i]);
  });
  return out;
}

// ── SVG → BMP (24-bit, bottom-up, non compressé) ─────────────────────────────
async function svgToBmp(svgStr, w, h) {
  const raw = await sharp(Buffer.from(svgStr), { density: 144 })
    .resize(w, h)
    .removeAlpha()
    .raw()
    .toBuffer();

  const rowStride = Math.ceil(w * 3 / 4) * 4;
  const dataSize  = rowStride * h;
  const out       = Buffer.alloc(54 + dataSize, 0);

  // File header
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(54 + dataSize, 2);
  out.writeUInt32LE(54, 10);
  // Info header (BITMAPINFOHEADER)
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);   // positif = bottom-up (standard)
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(0, 30);
  out.writeUInt32LE(dataSize, 34);
  out.writeInt32LE(2835, 38); out.writeInt32LE(2835, 42);

  // Pixels (RGB → BGR, rows inversées pour bottom-up)
  for (let y = 0; y < h; y++) {
    const srcRow = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const s = (srcRow * w + x) * 3;
      const d = 54 + y * rowStride + x * 3;
      out[d]   = raw[s + 2]; // B
      out[d+1] = raw[s + 1]; // G
      out[d+2] = raw[s];     // R
    }
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const buildDir = path.join(__dirname, '../build');
  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

  // App icon — ICO (Windows)
  const icoSizes = [256, 128, 64, 48, 32, 16];
  const icoPngs  = await Promise.all(icoSizes.map(s =>
    sharp(Buffer.from(ICON_SVG), { density: 300 }).resize(s, s).png().toBuffer()
  ));
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(icoPngs));
  console.log('icon.ico written (%d sizes)', icoSizes.length);

  // App icon — PNG 1024×1024 (macOS .icns source via electron-builder)
  const macPng = await sharp(Buffer.from(ICON_SVG), { density: 300 }).resize(1024, 1024).png().toBuffer();
  fs.writeFileSync(path.join(buildDir, 'icon.png'), macPng);
  console.log('icon.png (1024×1024) written');

  // Installer header
  const header = await svgToBmp(HEADER_SVG, 150, 57);
  fs.writeFileSync(path.join(buildDir, 'header.bmp'), header);
  console.log('header.bmp written');

  // Installer sidebar
  const sidebar = await svgToBmp(SIDEBAR_SVG, 164, 314);
  fs.writeFileSync(path.join(buildDir, 'sidebar.bmp'), sidebar);
  console.log('sidebar.bmp written');
}

main().catch(err => { console.error(err); process.exit(1); });
