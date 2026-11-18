// One-page "front page" of the world's news on Wednesday 18 November 2026.
// Node 22, standard library only, no network: draws the page into a pixel buffer,
// encodes it as PNG and writes it to /output/entry.png (or $MAKEFUN_OUTPUT_DIR).
// Every run writes the same bytes: nothing random, no clock, fixed zlib level.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;
const SS = 2; // supersampling factor: draw at 2048x2048, average down for smooth edges
const CW = W * SS;
const CH = H * SS;
const buf = new Uint8Array(CW * CH * 3);

// ---------- colours ----------
const PAPER = [246, 241, 230];
const INK = [24, 24, 28];
const RED = [178, 34, 34];
const GREY = [78, 74, 68]; // dark enough to stay readable when the page is shown at 300 px
const RULE = [60, 56, 50];

// ---------- primitives (coordinates in final 1024 px space) ----------
function px(x, y, c) {
  if (x < 0 || y < 0 || x >= CW || y >= CH) return;
  const i = (y * CW + x) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}
function rect(x, y, w, h, c) {
  const x0 = Math.round(x * SS), y0 = Math.round(y * SS);
  const x1 = Math.round((x + w) * SS), y1 = Math.round((y + h) * SS);
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) px(xx, yy, c);
}
function circle(cx, cy, r, c) {
  const X = cx * SS, Y = cy * SS, R = r * SS;
  for (let yy = Math.floor(Y - R); yy <= Math.ceil(Y + R); yy++)
    for (let xx = Math.floor(X - R); xx <= Math.ceil(X + R); xx++) {
      const dx = xx + 0.5 - X, dy = yy + 0.5 - Y;
      if (dx * dx + dy * dy <= R * R) px(xx, yy, c);
    }
}
function ring(cx, cy, r, t, c) {
  const X = cx * SS, Y = cy * SS, R = r * SS, r2 = (r - t) * SS;
  for (let yy = Math.floor(Y - R); yy <= Math.ceil(Y + R); yy++)
    for (let xx = Math.floor(X - R); xx <= Math.ceil(X + R); xx++) {
      const dx = xx + 0.5 - X, dy = yy + 0.5 - Y, d = dx * dx + dy * dy;
      if (d <= R * R && d >= r2 * r2) px(xx, yy, c);
    }
}
// filled polygon, even-odd scanline
function poly(pts, c) {
  const P = pts.map(([x, y]) => [x * SS, y * SS]);
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of P) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let yy = Math.floor(minY); yy <= Math.ceil(maxY); yy++) {
    const sy = yy + 0.5, xs = [];
    for (let i = 0; i < P.length; i++) {
      const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length];
      if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let xx = Math.ceil(xs[k] - 0.5); xx < Math.ceil(xs[k + 1] - 0.5); xx++) px(xx, yy, c);
  }
}
function line(x0, y0, x1, y1, t, c) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * t / 2, ny = (dx / L) * t / 2;
  poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], c);
}

// ---------- 5x7 pixel font ----------
const FONT = {
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '00100', '01000'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
  "'": ['01100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '$': ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '/': ['00001', '00001', '00010', '00100', '01000', '10000', '10000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '%': ['11000', '11001', '00010', '00100', '01000', '10011', '00011'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '*': ['00000', '00100', '10101', '01110', '10101', '00100', '00000'],
};

// draws text; s = size of one font pixel. Returns the width drawn.
function text(str, x, y, s, c) {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const g = FONT[ch] || FONT['?'];
    for (let r = 0; r < 7; r++)
      for (let k = 0; k < 5; k++)
        if (g[r][k] === '1') rect(cx + k * s, y + r * s, s, s, c);
    cx += 6 * s;
  }
  return cx - x - s;
}
const textW = (str, s) => str.length * 6 * s - s;
function center(str, cx, y, s, c) { text(str, cx - textW(str, s) / 2, y, s, c); }
function wrap(str, maxChars) {
  const out = [];
  let cur = '';
  for (const w of str.split(' ')) {
    if (cur && (cur + ' ' + w).length > maxChars) { out.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) out.push(cur);
  return out;
}
// headline block: wraps to fit width w; returns y after the block
function block(str, x, y, w, s, c, gap = 3) {
  const lines = wrap(str, Math.floor((w + s) / (6 * s)));
  for (const l of lines) { text(l, x, y, s, c); y += 7 * s + gap * s / 1.5; }
  return y;
}

// ---------- icons (each drawn inside a box at x,y of size z) ----------
function flagUS(x, y, w, h) {
  for (let i = 0; i < 7; i++) rect(x, y + (i * h) / 7, w, h / 14, RED);
  for (let i = 0; i < 7; i++) rect(x, y + (i * h) / 7 + h / 14, w, h / 14, [250, 250, 250]);
  rect(x, y, w * 0.42, h * 0.54, [40, 60, 130]);
}
function star(cx, cy, r, c) {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r;
    p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  poly(p, c);
}
function flagCN(x, y, w, h) {
  rect(x, y, w, h, [222, 41, 16]);
  star(x + w * 0.2, y + h * 0.3, h * 0.2, [255, 222, 0]);
  for (const [a, b] of [[0.38, 0.12], [0.45, 0.25], [0.45, 0.42], [0.38, 0.55]]) star(x + w * a, y + h * b, h * 0.07, [255, 222, 0]);
}
function flagRU(x, y, w, h) {
  rect(x, y, w, h / 3, [250, 250, 250]);
  rect(x, y + h / 3, w, h / 3, [0, 57, 166]);
  rect(x, y + (2 * h) / 3, w, h / 3, [213, 43, 30]);
}
function frame(x, y, w, h) {
  rect(x - 2, y - 2, w + 4, 2, INK); rect(x - 2, y + h, w + 4, 2, INK);
  rect(x - 2, y, 2, h, INK); rect(x + w, y, 2, h, INK);
}
function iconDrone(x, y, z) {
  const cx = x + z / 2, cy = y + z / 2;
  line(cx - z * 0.3, cy - z * 0.3, cx + z * 0.3, cy + z * 0.3, z * 0.08, INK);
  line(cx - z * 0.3, cy + z * 0.3, cx + z * 0.3, cy - z * 0.3, z * 0.08, INK);
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ring(cx + dx * z * 0.3, cy + dy * z * 0.3, z * 0.15, z * 0.05, INK);
  circle(cx, cy, z * 0.1, RED);
}
function iconChart(x, y, z) {
  const bars = [0.35, 0.25, 0.45, 0.8];
  bars.forEach((b, i) => rect(x + z * 0.08 + i * z * 0.22, y + z * (0.95 - b), z * 0.15, z * b, i === 3 ? [20, 130, 60] : GREY));
  rect(x, y + z * 0.95, z, z * 0.04, INK);
  line(x + z * 0.1, y + z * 0.55, x + z * 0.8, y + z * 0.12, z * 0.05, [20, 130, 60]);
  poly([[x + z * 0.86, y + z * 0.05], [x + z * 0.68, y + z * 0.1], [x + z * 0.82, y + z * 0.24]], [20, 130, 60]);
}
function iconGlobe(x, y, z) {
  const cx = x + z / 2, cy = y + z / 2, r = z * 0.44;
  circle(cx, cy, r, [70, 130, 190]);
  poly([[cx - r * 0.6, cy - r * 0.5], [cx - r * 0.1, cy - r * 0.7], [cx + r * 0.1, cy - r * 0.2], [cx - r * 0.3, cy + r * 0.3], [cx - r * 0.7, cy]], [60, 150, 80]);
  poly([[cx + r * 0.2, cy + r * 0.1], [cx + r * 0.7, cy - r * 0.2], [cx + r * 0.6, cy + r * 0.5], [cx + r * 0.3, cy + r * 0.7]], [60, 150, 80]);
  // thermometer
  rect(x + z * 0.8, y + z * 0.05, z * 0.12, z * 0.7, [250, 250, 250]);
  frame(x + z * 0.8, y + z * 0.05, z * 0.12, z * 0.7);
  rect(x + z * 0.82, y + z * 0.3, z * 0.08, z * 0.5, RED);
  circle(x + z * 0.86, y + z * 0.85, z * 0.1, RED);
}
function iconTentRain(x, y, z) {
  for (let i = 0; i < 6; i++) line(x + z * (0.1 + i * 0.16), y + z * 0.02, x + z * (0.04 + i * 0.16), y + z * 0.25, z * 0.03, [70, 120, 190]);
  poly([[x + z * 0.5, y + z * 0.3], [x + z * 0.95, y + z * 0.85], [x + z * 0.05, y + z * 0.85]], [200, 180, 140]);
  poly([[x + z * 0.5, y + z * 0.5], [x + z * 0.62, y + z * 0.85], [x + z * 0.38, y + z * 0.85]], INK);
  rect(x, y + z * 0.86, z, z * 0.1, [70, 120, 190]);
}
function iconShield(x, y, z) {
  const p = [[x + z * 0.1, y + z * 0.05], [x + z * 0.9, y + z * 0.05], [x + z * 0.9, y + z * 0.5], [x + z * 0.5, y + z * 0.98], [x + z * 0.1, y + z * 0.5]];
  poly(p, [0, 87, 183]);
  poly([[x + z * 0.1, y + z * 0.5], [x + z * 0.9, y + z * 0.5], [x + z * 0.5, y + z * 0.98]], [255, 213, 0]);
  // missile streak
  line(x + z * 0.25, y + z * 0.45, x + z * 0.7, y + z * 0.15, z * 0.09, [250, 250, 250]);
  poly([[x + z * 0.78, y + z * 0.08], [x + z * 0.64, y + z * 0.12], [x + z * 0.72, y + z * 0.22]], [250, 250, 250]);
}
function iconIsland(x, y, z) {
  rect(x, y + z * 0.7, z, z * 0.3, [70, 130, 190]);
  poly([[x + z * 0.1, y + z * 0.75], [x + z * 0.5, y + z * 0.55], [x + z * 0.9, y + z * 0.75]], [220, 200, 140]);
  line(x + z * 0.5, y + z * 0.6, x + z * 0.5, y + z * 0.1, z * 0.04, INK);
  poly([[x + z * 0.52, y + z * 0.1], [x + z * 0.9, y + z * 0.2], [x + z * 0.52, y + z * 0.3]], RED);
  text('?', x + z * 0.62, y + z * 0.14, z * 0.025, [250, 250, 250]);
}

// ---------- the page ----------
rect(0, 0, W, H, PAPER);

// masthead
rect(0, 0, W, 8, INK);
center('THE WORLD IN ONE DAY', W / 2, 26, 8, INK);
rect(24, 92, W - 48, 3, INK);
center('WEDNESDAY 18 NOVEMBER 2026', W / 2, 106, 6, RED);
rect(24, 156, W - 48, 3, INK);

// lead story
const LY = 172;
flagUS(32, LY + 8, 92, 58); frame(32, LY + 8, 92, 58);
flagCN(32, LY + 78, 92, 58); frame(32, LY + 78, 92, 58);
flagRU(32, LY + 148, 92, 58); frame(32, LY + 148, 92, 58);
text('APEC  SHENZHEN, CHINA', 148, LY + 6, 3, RED);
let ly = block('TRUMP LANDS IN CHINA AS XI AND PUTIN MEET', 148, LY + 36, W - 180, 7, INK);
block('APEC LEADERS GATHER; RARE TRUMP-XI-PUTIN THREE-WAY TALKS SET FOR THURSDAY', 148, ly + 4, W - 180, 3, GREY);
rect(24, 400, W - 48, 3, INK);

// six panels: 3 columns x 2 rows
// headlines are written to wrap into at most 3 lines of 13 characters at size 4
const panels = [
  // subs wrap into at most 2 lines of 16 characters at size 3 (still legible at 300 px)
  { tag: 'GULF', head: 'IRAN DRONES TARGET US KUWAIT BASE', sub: 'INTERCEPTED; US SAYS NO DAMAGE', icon: iconDrone },
  { tag: 'MARKETS', head: 'NVIDIA RECORD ENDS TECH SELLOFF', sub: '$115.8BN SALES; GOLD BELOW $3.8K', icon: iconChart },
  { tag: 'CLIMATE', head: 'COP31 ROW OVER FOSSIL FUEL EXIT', sub: 'EU WARNS ON DRAFT IN ANTALYA', icon: iconGlobe },
  { tag: 'GAZA', head: 'WHO: LET AID IN AS FLOODS HIT CAMPS', sub: 'UK SANCTIONS 8 SETTLEMENT FIRMS', icon: iconTentRain },
  { tag: 'UKRAINE', head: 'GERMANY SENDS AIR DEFENCE AID', sub: 'MISSILES, F-16 AMMUNITION', icon: iconShield },
  { tag: 'AFRICA', head: 'CHAGOS: MAURITIUS WARNS UK', sub: 'HAND BACK BY DEC OR FACE COURT', icon: iconIsland },
];
const PW = (W - 48) / 3, PH = 250, PY = 412;
panels.forEach((p, i) => {
  const col = i % 3, row = Math.floor(i / 3);
  const x = 24 + col * PW + 12, y = PY + row * PH;
  if (col > 0) rect(24 + col * PW - 1, y + 6, 2, PH - 18, RULE);
  p.icon(x, y + 8, 62);
  text(p.tag, x + 76, y + 30, 3.5, RED);
  const yy = block(p.head, x, y + 80, PW - 24, 4, INK);
  block(p.sub, x, yy, PW - 24, 3, GREY, 2);
});
rect(24, PY + PH - 4, W - 48, 2, RULE);

// briefs ticker
const TY = PY + 2 * PH;
rect(0, TY, W, H - TY, INK);
const YEL = [255, 200, 60], WHITE = [250, 250, 250];
const ax = 24 + text('ALSO:', 24, TY + 22, 3, YEL) + 18;
text("MONGOLIA'S PRESIDENT TO STEP DOWN", ax, TY + 14, 3, WHITE);
text("PARAGUAY'S ATTORNEY GENERAL RESIGNS", ax, TY + 46, 3, WHITE);
text('GTA VI LAUNCHES AT MIDNIGHT AFTER 13 YEARS', ax, TY + 78, 3, WHITE);

// ---------- downsample + PNG ----------
const img = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    for (let ch = 0; ch < 3; ch++) {
      let s = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += buf[((y * SS + dy) * CW + x * SS + dx) * 3 + ch];
      img[(y * W + x) * 3 + ch] = Math.round(s / (SS * SS));
    }

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) { raw[y * (1 + W * 3)] = 0; Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.png'), png);
