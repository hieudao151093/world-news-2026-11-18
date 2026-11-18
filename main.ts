// One-page "front page" of the world's news on Wednesday 18 November 2026.
// Node 22, standard library only, no network: draws the page into a pixel buffer with
// anti-aliased vector shapes and a hand-made single-stroke typeface, encodes it as PNG and
// writes it to /output/entry.png (or $MAKEFUN_OUTPUT_DIR). No randomness, no clock: every
// run writes the same bytes.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;
const img = new Float32Array(W * H * 3); // linear 0..255 RGB
const cov = new Float32Array(W * H); // scratch coverage mask for one draw call

// ---------- colours ----------
const PAPER = [248, 244, 235];
const INK = [22, 22, 26];
const RED = [176, 30, 30];
const GREY = [70, 68, 64];
const SEA = [214, 229, 238];
const LAND = [196, 186, 162];
const WHITE = [255, 255, 255];

// ---------- coverage mask helpers ----------
let bx0 = W, by0 = H, bx1 = 0, by1 = 0; // dirty box of the mask
function touch(x0, y0, x1, y1) {
  bx0 = Math.max(0, Math.min(bx0, Math.floor(x0)));
  by0 = Math.max(0, Math.min(by0, Math.floor(y0)));
  bx1 = Math.min(W - 1, Math.max(bx1, Math.ceil(x1)));
  by1 = Math.min(H - 1, Math.max(by1, Math.ceil(y1)));
}
// composite the mask in colour c, then clear it
function flush(c, alpha = 1) {
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const i = y * W + x, a = cov[i] * alpha;
      if (a <= 0) continue;
      const p = i * 3;
      img[p] += (c[0] - img[p]) * a;
      img[p + 1] += (c[1] - img[p + 1]) * a;
      img[p + 2] += (c[2] - img[p + 2]) * a;
      cov[i] = 0;
    }
  bx0 = W; by0 = H; bx1 = 0; by1 = 0;
}
// a round-capped segment of radius r, exact area-ish coverage by distance
function capsule(ax, ay, bx, by, r) {
  const x0 = Math.min(ax, bx) - r - 1, x1 = Math.max(ax, bx) + r + 1;
  const y0 = Math.min(ay, by) - r - 1, y1 = Math.max(ay, by) + r + 1;
  touch(x0, y0, x1, y1);
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
      const px = x + 0.5 - ax, py = y + 0.5 - ay;
      let t = (px * dx + py * dy) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - t * dx, ey = py - t * dy;
      const v = r + 0.5 - Math.sqrt(ex * ex + ey * ey);
      if (v > 0) { const i = y * W + x; const c = v > 1 ? 1 : v; if (c > cov[i]) cov[i] = c; }
    }
}
// filled polygon with 5 sub-scanlines per pixel and exact horizontal coverage
function polyMask(pts) {
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const [x, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  touch(minX - 1, minY - 1, maxX + 1, maxY + 1);
  const S = 5;
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++)
    for (let s = 0; s < S; s++) {
      const sy = y + (s + 0.5) / S, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, xs[k]), b = Math.min(W, xs[k + 1]);
        if (b <= a) continue;
        for (let x = Math.floor(a); x < Math.ceil(b); x++) {
          const c = Math.min(b, x + 1) - Math.max(a, x);
          if (c > 0) cov[y * W + x] = Math.min(1, cov[y * W + x] + c / S);
        }
      }
    }
}
function rect(x, y, w, h, c) { polyMask([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]); flush(c); }
function disc(cx, cy, r, c) {
  touch(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1);
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const v = r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (v > 0) cov[y * W + x] = Math.max(cov[y * W + x], Math.min(1, v));
    }
  flush(c);
}
function line(ax, ay, bx, by, t, c) { capsule(ax, ay, bx, by, t / 2); flush(c); }
function poly(pts, c) { polyMask(pts); flush(c); }

// ---------- single-stroke typeface ----------
// Units: cap height 10, x-height 3..10, baseline y=10, descender to 13.5. y grows downwards.
// Commands: "M x y" start a stroke, "L x y" continue it, "E cx cy rx ry a0 a1" an elliptical
// arc in degrees (0 = right, 90 = down) that starts a stroke of its own; a later L continues it.
const G = {
  A: [8, 'M0 10 L4 0 L8 10 M1.5 6.6 L6.5 6.6'],
  B: [7, 'M0 0 L0 10 M0 0 L3.8 0 E3.8 2.5 2.6 2.5 -90 90 L0 5 M0 5 L4.1 5 E4.1 7.5 2.9 2.5 -90 90 L0 10'],
  C: [8.4, 'E5 5 5 5 38 322'],
  D: [8, 'M0 0 L0 10 L3 10 E3 5 5 5 90 -90 L0 0'],
  E: [6.2, 'M6.2 0 L0 0 L0 10 L6.2 10 M0 5 L5.4 5'],
  F: [6, 'M6 0 L0 0 L0 10 M0 5 L5.2 5'],
  G: [8.6, 'E5 5 5 5 -40 318 M9.8 5.6 L5.6 5.6 M9.8 5.6 L9.8 9'],
  H: [8, 'M0 0 L0 10 M8 0 L8 10 M0 5 L8 5'],
  I: [0, 'M0 0 L0 10'],
  J: [5, 'M5 0 L5 7.3 E2.6 7.3 2.4 2.7 0 160'],
  K: [7, 'M0 0 L0 10 M7 0 L0 6.6 M2.5 4.5 L7.2 10'],
  L: [6, 'M0 0 L0 10 L6 10'],
  M: [9.4, 'M0 10 L0 0 L4.7 8 L9.4 0 L9.4 10'],
  N: [8, 'M0 10 L0 0 L8 10 L8 0'],
  O: [10, 'E5 5 5 5 0 360'],
  P: [7, 'M0 10 L0 0 L4 0 E4 2.8 3 2.8 -90 90 L0 5.6'],
  Q: [10, 'E5 5 5 5 0 360 M6.4 7 L10 10.6'],
  R: [7.2, 'M0 10 L0 0 L4 0 E4 2.8 3 2.8 -90 90 L0 5.6 M3.6 5.6 L7.2 10'],
  S: [7, 'E3.5 2.6 3.4 2.6 -25 -270 E3.5 7.5 3.5 2.5 -90 155'],
  T: [8, 'M0 0 L8 0 M4 0 L4 10'],
  U: [8, 'M0 0 L0 6 E4 6 4 4 180 0 L8 0'],
  V: [8.4, 'M0 0 L4.2 10 L8.4 0'],
  W: [12, 'M0 0 L2.8 10 L6 1.5 L9.2 10 L12 0'],
  X: [8, 'M0 0 L8 10 M8 0 L0 10'],
  Y: [8, 'M0 0 L4 5.2 L8 0 M4 5.2 L4 10'],
  Z: [7.4, 'M0 0 L7.4 0 L0 10 L7.4 10'],
  a: [6, 'E3 6.5 3 3.5 0 360 M6 3 L6 10'],
  b: [6, 'M0 0 L0 10 E3 6.5 3 3.5 0 360'],
  c: [6, 'E3.3 6.5 3.3 3.5 45 315'],
  d: [6, 'E3 6.5 3 3.5 0 360 M6 0 L6 10'],
  e: [6.4, 'M0.3 6.5 L6.4 6.5 E3.3 6.5 3.1 3.5 0 -310'],
  f: [4, 'E3.6 2.4 1.9 2.1 300 180 L1.7 10 M0 3.6 L4 3.6'],
  g: [6, 'E3 6.5 3 3.5 0 360 M6 3 L6 11 E3.1 11 2.9 2.5 0 165'],
  h: [6, 'M0 0 L0 10 M0 6 E3 6 3 3 180 360 L6 10'],
  i: [0, 'M0 3 L0 10 M0 0.4 L0 0.9'],
  j: [2.2, 'M2.2 3 L2.2 11 E0.2 11 2 2.4 0 110 M2.2 0.4 L2.2 0.9'],
  k: [6, 'M0 0 L0 10 M6 3 L0 7.6 M2.1 6 L6.2 10'],
  l: [0, 'M0 0 L0 10'],
  m: [10, 'M0 3 L0 10 E2.5 5.6 2.5 2.6 180 360 L5 10 E7.5 5.6 2.5 2.6 180 360 L10 10'],
  n: [6, 'M0 3 L0 10 E3 6 3 3 180 360 L6 10'],
  o: [7, 'E3.5 6.5 3.5 3.5 0 360'],
  p: [6, 'M0 3 L0 13.5 E3 6.5 3 3.5 0 360'],
  q: [6, 'E3 6.5 3 3.5 0 360 M6 3 L6 13.5'],
  r: [4, 'M0 3 L0 10 E3.8 6.8 3.8 3.6 180 285'],
  s: [5.2, 'E2.6 4.8 2.5 1.8 -30 -270 E2.6 8.3 2.6 1.75 -90 155'],
  t: [4, 'M1.5 0.6 L1.5 8.4 E3.1 8.4 1.6 1.6 180 70 M0 3.4 L4 3.4'],
  u: [6, 'M0 3 L0 7 E3 7 3 3 180 0 M6 3 L6 10'],
  v: [6.4, 'M0 3 L3.2 10 L6.4 3'],
  w: [9.6, 'M0 3 L2.3 10 L4.8 4.2 L7.3 10 L9.6 3'],
  x: [6, 'M0 3 L6 10 M6 3 L0 10'],
  y: [6.4, 'M0 3 L3.3 10 M6.4 3 L2.2 13.5'],
  z: [6, 'M0 3 L6 3 L0 10 L6 10'],
  '0': [7, 'E3.5 5 3.5 5 0 360'],
  '1': [4, 'M0.4 2.2 L3.2 0 L3.2 10'],
  '2': [7, 'E3.5 3.2 3.3 3.2 195 360 L0 10 L7 10'],
  '3': [7, 'E3.4 2.7 3.1 2.7 -160 90 E3.4 7.5 3.5 2.5 -90 160'],
  '4': [7.4, 'M5.2 10 L5.2 0 L0 7 L7.4 7'],
  '5': [7, 'M6.4 0 L1 0 L0.6 4.7 E3.5 6.8 3.4 3.2 -140 150'],
  '6': [7, 'E3.5 6.8 3.3 3.2 0 360 M5.4 0 L0.5 5.9'],
  '7': [7, 'M0 0 L7 0 L2.6 10'],
  '8': [7, 'E3.5 2.6 3 2.6 0 360 E3.5 7.5 3.5 2.5 0 360'],
  '9': [7, 'E3.5 3.2 3.3 3.2 0 360 M6.5 4.1 L1.6 10'],
  ' ': [2.2, ''],
  '.': [0, 'M0 9.7 L0 9.8'],
  ',': [1, 'M1 9.5 L0 11.8'],
  ':': [0, 'M0 3.9 L0 4 M0 9.7 L0 9.8'],
  ';': [1, 'M1 3.9 L1 4 M1 9.5 L0 11.8'],
  "'": [0, 'M0 0 L0 3'],
  '-': [4, 'M0 6 L4 6'],
  '$': [6.4, 'E3.2 2.6 3 2.4 -25 -270 E3.2 7.5 3.2 2.5 -90 155 M3.2 -1 L3.2 11'],
  '%': [8, 'E1.6 2.2 1.6 2.2 0 360 E6.4 7.8 1.6 2.2 0 360 M7.2 0 L0.8 10'],
  '/': [5, 'M5 -0.5 L0 10.5'],
  '(': [3, 'E5 5 5 6.6 125 235'],
  ')': [3, 'E-2 5 5 6.6 -55 55'],
  '!': [0, 'M0 0 L0 7 M0 9.7 L0 9.8'],
  '?': [6, 'E3 2.8 3 2.8 190 420 L3 7 M3 9.7 L3 9.8'],
  '+': [6, 'M0 5.5 L6 5.5 M3 2.5 L3 8.5'],
};
// parse glyphs into polylines
const GLYPH = {};
for (const ch of Object.keys(G)) {
  const [w, d] = G[ch], t = d.match(/[MLE]|-?\d*\.?\d+/g) || [], lines = [];
  let cur = null;
  for (let i = 0; i < t.length;) {
    const op = t[i++];
    if (op === 'M') { cur = [[+t[i], +t[i + 1]]]; lines.push(cur); i += 2; }
    else if (op === 'L') { cur.push([+t[i], +t[i + 1]]); i += 2; }
    else if (op === 'E') {
      const [cx, cy, rx, ry, a0, a1] = t.slice(i, i + 6).map(Number); i += 6;
      const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 10));
      cur = [];
      for (let k = 0; k <= n; k++) {
        const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
        cur.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
      }
      lines.push(cur);
    }
  }
  GLYPH[ch] = { w, lines };
}
const LIGHT = 1.15, REG = 1.45, BOLD = 2.05; // stroke widths in font units
const glyphOf = (ch) => GLYPH[ch] || GLYPH[ch === '’' ? "'" : '?'];
// advance of one glyph in font units, tracking adds extra space between letters
const adv = (g, wt, tr) => (g === GLYPH[' '] ? 2.2 + wt : g.w + wt + 1.5 + tr);
function measure(str, size, wt = REG, tr = 0) {
  let u = 0;
  for (const ch of str) u += adv(glyphOf(ch), wt, tr);
  return (u - 1.5 - tr) * (size / 10);
}
// draws text with its cap top at y; size = cap height in px. Returns the width.
function text(str, x, y, size, c, wt = REG, tr = 0) {
  const s = size / 10, r = (wt * s) / 2;
  let cx = x + r;
  for (const ch of str) {
    const g = glyphOf(ch);
    for (const pl of g.lines) {
      if (pl.length === 1) capsule(cx + pl[0][0] * s, y + pl[0][1] * s, cx + pl[0][0] * s, y + pl[0][1] * s, r);
      for (let k = 0; k + 1 < pl.length; k++)
        capsule(cx + pl[k][0] * s, y + pl[k][1] * s, cx + pl[k + 1][0] * s, y + pl[k + 1][1] * s, r);
    }
    cx += adv(g, wt, tr) * s;
  }
  flush(c);
  return measure(str, size, wt, tr);
}
function wrap(str, size, wt, maxW) {
  const out = [];
  let cur = '';
  for (const word of str.split(' ')) {
    const t = cur ? cur + ' ' + word : word;
    if (cur && measure(t, size, wt) > maxW) { out.push(cur); cur = word; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}
// wrapped paragraph; returns the y below it
function para(str, x, y, size, c, wt, maxW, lead = 1.55) {
  for (const l of wrap(str, size, wt, maxW)) { text(l, x, y, size, c, wt); y += size * lead; }
  return y;
}
// largest size (<= max) at which str fits in maxW
function fit(str, max, wt, maxW, tr = 0) {
  let s = max;
  while (s > 6 && measure(str, s, wt, tr) > maxW) s -= 0.5;
  return s;
}
function badge(n, cx, cy, r, bg = RED) {
  disc(cx, cy, r, bg);
  const s = r * 0.95, label = String(n);
  text(label, cx - measure(label, s, BOLD) / 2, cy - s / 2, s, WHITE, BOLD);
}

// ---------- the stories of Wednesday 18 November 2026 ----------
const LEAD = {
  kicker: 'APEC SUMMIT, SHENZHEN',
  head: 'Trump lands in China for APEC',
  ctx: 'Xi and Putin meet in Shenzhen; rare three-way talks set for Thursday',
  at: [114.1, 22.5],
};
// [category, headline of 3-7 words, lon, lat]; lon null = no single place on the map.
// Reading order: the left column, then the right one; numbers follow it, after the lead's 1.
const ROWS = [
  ['conflict', 'Iran drones target US base', 47.9, 29.3],
  ['economy', 'Nvidia record lifts stocks', -74.0, 40.7],
  ['climate', 'COP31 split on fossil fuels', 30.7, 36.9],
  ['health', 'Gaza floods: WHO urges aid', 34.4, 31.5],
  ['economy', 'EU plans EUR 45bn Kyiv loan', 4.4, 50.8],
  ['conflict', 'German air defence for Kyiv', 13.4, 52.5],
  ['politics', 'UK sanctions West Bank firms', 35.2, 31.9],
  ['conflict', 'US officer held over spying', -0.1, 51.5],
  ['conflict', 'Serbian military jet crashes', 20.2, 45.0],
  ['conflict', 'Siberia plane crash kills 19', 86.1, 55.4],
  ['economy', 'ECB likens AI boom to dotcom', 8.7, 50.1],
  ['economy', 'Gold falls below $3,800', null, null],
  ['politics', 'Chagos: Mauritius warns UK', 57.5, -20.2],
  ['politics', 'Pretoria rebukes Nigeria envoy', 28.2, -25.7],
  ['politics', "Mongolia's president to quit", 106.9, 47.9],
  ['politics', "Xi meets South Korea's Lee", null, null],
  ['economy', 'Bangladesh garment protests', 90.4, 23.8],
  ['economy', 'Air Niugini adds fuel charge', 147.2, -9.4],
  ['politics', 'Peltola wins Alaska Senate', -149.9, 61.2],
  ['economy', 'Canada, China ease tariffs', -75.7, 45.4],
  ['politics', 'Paraguay top prosecutor quits', -57.6, -25.3],
  ['economy', 'Venezuela unions call strike', -66.9, 10.5],
  ['tech', 'AI finds critical Java flaw', null, null],
  ['culture', 'GTA VI launches at midnight', null, null],
  ['sport', 'Knicks beat Raptors 111-102', -79.4, 43.7],
  ['sport', 'Diallo enters FIFA race', 8.5, 47.4],
];
const STORIES = ROWS.length + 1;

// ---------- section icons, drawn in a box of side s ----------
const CAT = {
  politics: [36, 70, 150], conflict: [196, 40, 30], economy: [20, 125, 60], climate: [0, 128, 150],
  health: [205, 30, 45], tech: [105, 60, 165], sport: [225, 115, 15], culture: [170, 40, 125],
};
function icon(cat, x, y, s) {
  const c = CAT[cat];
  if (cat === 'politics') {
    poly([[x + s * 0.5, y + s * 0.02], [x + s, y + s * 0.3], [x, y + s * 0.3]], c);
    for (const k of [0.1, 0.42, 0.74]) rect(x + s * k, y + s * 0.36, s * 0.16, s * 0.44, c);
    rect(x, y + s * 0.84, s, s * 0.14, c);
  } else if (cat === 'conflict') {
    const p = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8, r = i % 2 ? s * 0.22 : s * 0.5;
      p.push([x + s / 2 + Math.cos(a) * r, y + s / 2 + Math.sin(a) * r]);
    }
    poly(p, c);
  } else if (cat === 'economy') {
    rect(x + s * 0.04, y + s * 0.56, s * 0.24, s * 0.42, c);
    rect(x + s * 0.38, y + s * 0.32, s * 0.24, s * 0.66, c);
    rect(x + s * 0.72, y + s * 0.04, s * 0.24, s * 0.94, c);
  } else if (cat === 'climate') {
    line(x + s * 0.5, y + s * 0.12, x + s * 0.5, y + s * 0.62, s * 0.26, c);
    disc(x + s * 0.5, y + s * 0.76, s * 0.23, c);
    line(x + s * 0.5, y + s * 0.3, x + s * 0.5, y + s * 0.7, s * 0.08, WHITE);
  } else if (cat === 'health') {
    rect(x + s * 0.34, y, s * 0.32, s, c);
    rect(x, y + s * 0.34, s, s * 0.32, c);
  } else if (cat === 'tech') {
    for (const k of [0.3, 0.5, 0.7]) {
      line(x + s * k, y, x + s * k, y + s, s * 0.08, c);
      line(x, y + s * k, x + s, y + s * k, s * 0.08, c);
    }
    rect(x + s * 0.16, y + s * 0.16, s * 0.68, s * 0.68, c);
    rect(x + s * 0.34, y + s * 0.34, s * 0.32, s * 0.32, WHITE);
  } else if (cat === 'sport') {
    disc(x + s / 2, y + s / 2, s * 0.48, c);
    line(x + s / 2, y + s * 0.04, x + s / 2, y + s * 0.96, s * 0.07, WHITE);
    line(x + s * 0.04, y + s / 2, x + s * 0.96, y + s / 2, s * 0.07, WHITE);
  } else if (cat === 'culture') {
    rect(x, y + s * 0.08, s, s * 0.84, c);
    poly([[x + s * 0.36, y + s * 0.26], [x + s * 0.74, y + s * 0.5], [x + s * 0.36, y + s * 0.74]], WHITE);
  }
}

// ---------- coastlines, [lon, lat], smoothed with Chaikin's corner cutting ----------
const LANDS = [
  [[-168, 66], [-162, 70], [-140, 70], [-125, 70], [-95, 72], [-80, 73], [-62, 66], [-55, 52], [-66, 45], [-70, 41], [-76, 35], [-81, 31], [-80, 25], [-83, 29], [-90, 29], [-97, 26], [-97, 20], [-90, 21], [-87, 15], [-83, 9], [-79, 8], [-84, 10], [-88, 13], [-92, 15], [-105, 20], [-110, 24], [-112, 31], [-117, 32], [-124, 40], [-124, 48], [-130, 55], [-140, 60], [-152, 58], [-165, 60]],
  [[-73, 78], [-60, 82], [-30, 83], [-20, 75], [-22, 70], [-40, 65], [-45, 60], [-52, 64], [-60, 70]],
  [[-80, 9], [-75, 11], [-62, 10], [-50, 1], [-35, -5], [-38, -13], [-40, -22], [-48, -26], [-53, -34], [-58, -38], [-65, -42], [-68, -50], [-70, -55], [-74, -50], [-73, -40], [-71, -30], [-70, -18], [-76, -14], [-81, -5], [-80, 0], [-77, 4]],
  [[-10, 36], [-9, 43], [-2, 44], [-5, 48], [2, 51], [8, 54], [10, 57], [5, 58], [5, 62], [14, 68], [25, 71], [40, 68], [45, 68], [60, 70], [70, 73], [80, 73], [100, 77], [110, 74], [140, 72], [160, 70], [180, 68], [180, 65], [170, 60], [163, 58], [156, 51], [155, 59], [143, 59], [137, 54], [140, 48], [132, 43], [129, 35], [127, 39], [125, 40], [121, 39], [122, 31], [120, 25], [110, 20], [108, 21], [106, 10], [100, 13], [100, 7], [104, 1], [98, 8], [98, 16], [94, 17], [91, 22], [87, 21], [80, 15], [77, 8], [73, 17], [72, 22], [67, 25], [57, 25], [56, 27], [52, 28], [48, 30], [50, 26], [56, 24], [59, 22], [55, 17], [44, 12], [43, 15], [39, 22], [35, 28], [34, 31], [36, 36], [30, 36], [27, 37], [26, 40], [23, 40], [20, 40], [19, 42], [13, 45], [12, 44], [16, 41], [18, 40], [15, 38], [12, 42], [9, 44], [3, 43], [-1, 37], [-6, 36]],
  [[-17, 21], [-16, 28], [-10, 30], [-6, 36], [10, 37], [11, 33], [20, 32], [30, 31], [32, 31], [34, 28], [39, 18], [43, 12], [51, 12], [51, 10], [44, 0], [40, -3], [40, -11], [35, -20], [33, -26], [28, -33], [20, -35], [17, -29], [12, -17], [13, -8], [9, -1], [9, 4], [3, 6], [-8, 4], [-13, 8], [-17, 15]],
  [[44, -25], [47, -25], [50, -15], [49, -12], [44, -17]],
  [[114, -22], [122, -18], [130, -12], [137, -12], [137, -16], [141, -11], [146, -19], [153, -25], [150, -37], [141, -38], [135, -35], [129, -32], [115, -34], [113, -26]],
  [[-5, 50], [1, 51], [2, 53], [-2, 57], [-5, 58], [-6, 56], [-4, 54], [-5, 52]],
  [[-10, 52], [-6, 52], [-6, 55], [-8, 55]],
  [[130, 31], [135, 34], [140, 35], [142, 40], [141, 45], [139, 40], [133, 35]],
  [[95, 5], [106, -6], [104, -5], [98, 1]],
  [[109, 1], [117, 7], [119, 1], [116, -4], [110, -3]],
  [[131, -1], [141, -3], [150, -10], [143, -9], [138, -8]],
  [[105, -6], [114, -7], [114, -8], [106, -7]],
  [[172, -34], [178, -38], [174, -41], [171, -46], [167, -46], [172, -41]],
  [[120, 18], [122, 18], [126, 7], [122, 7]],
  [[-24, 64], [-14, 64], [-15, 66], [-22, 66]],
];
function chaikin(p, rounds) {
  for (let r = 0; r < rounds; r++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
      q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    p = q;
  }
  return p;
}

// ================= the page =================
rect(0, 0, W, H, PAPER);
const M = 16; // outer margin
rect(0, 0, W, 6, INK);

// masthead line
text('THE WORLD ON ONE PAGE', M, 17, 14, RED, BOLD, 1.6);
const mline = `${STORIES} stories, six continents`;
text(mline, W - M - measure(mline, 14, REG), 17, 14, GREY, REG);

// the date, as big as it fits
const DATE = 'Wednesday 18 November 2026';
const ds = fit(DATE, 56, BOLD, W - 2 * M);
text(DATE, (W - measure(DATE, ds, BOLD)) / 2, 44, ds, INK, BOLD);
let y = 44 + ds * 1.4;
rect(M, y, W - 2 * M, 3, INK);
y += 12;

// lead story with the three flags
function flagUS(x, fy, w, h) {
  for (let i = 0; i < 7; i++) rect(x, fy + (i * 2 * h) / 13, w, h / 13, RED);
  rect(x, fy, w * 0.42, h * 0.54, [40, 60, 130]);
}
function star(cx, cy, r, c) {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r;
    p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  poly(p, c);
}
function flagCN(x, fy, w, h) {
  rect(x, fy, w, h, [222, 41, 16]);
  star(x + w * 0.2, fy + h * 0.3, h * 0.2, [255, 222, 0]);
}
function flagRU(x, fy, w, h) {
  rect(x, fy + h / 3, w, h / 3, [0, 57, 166]);
  rect(x, fy + (2 * h) / 3, w, h / 3, [213, 43, 30]);
}
const FW = 54, FH = 33;
[flagUS, flagCN, flagRU].forEach((f, i) => {
  const fy = y + 1 + i * (FH + 5);
  rect(M, fy, FW, FH, WHITE);
  f(M, fy, FW, FH);
  rect(M - 1, fy - 1, FW + 2, 1, INK); rect(M - 1, fy + FH, FW + 2, 1, INK);
  rect(M - 1, fy, 1, FH, INK); rect(M + FW, fy, 1, FH, INK);
});
const flagsEnd = y + 3 * FH + 2 * 5 + 2;
const LX = M + FW + 18, LW = W - M - LX;
badge(1, LX + 10, y + 8, 10, INK);
text(LEAD.kicker, LX + 27, y + 1, 14, RED, BOLD, 1.3);
const hs = fit(LEAD.head, 42, BOLD, LW);
text(LEAD.head, LX, y + 26, hs, INK, BOLD);
const cs = fit(LEAD.ctx, 20, REG, LW);
text(LEAD.ctx, LX, y + 26 + hs * 1.5, cs, [45, 43, 40], REG);
y = Math.max(y + 26 + hs * 1.5 + cs * 1.45, flagsEnd) + 8;
rect(M, y, W - 2 * M, 2, INK);
y += 10;

// world map (equirectangular, lon -170..190, from lat 74 down as far as its height allows),
// smoothed coasts clipped to its frame
const ROWH = 37, NROW = Math.ceil(ROWS.length / 2);
const MW = W - 2 * M, MH = H - M - NROW * ROWH - 14 - y;
const MX = M, MY = y;
const LON0 = -170, LAT0 = 72, LATSPAN = (MH * 360) / MW;
const clampX = (v) => Math.min(MX + MW, Math.max(MX, v)), clampY = (v) => Math.min(MY + MH, Math.max(MY, v));
const proj = (lon, lat) => [MX + ((((lon - LON0) % 360) + 360) % 360) / 360 * MW, MY + ((LAT0 - lat) / LATSPAN) * MH];
rect(MX, MY, MW, MH, SEA);
for (const L of LANDS) poly(chaikin(L.map(([lo, la]) => proj(lo, la)), 2).map(([px, py]) => [clampX(px), clampY(py)]), LAND);
rect(MX, MY + MH - 1, MW, 1, [150, 145, 135]);
// numbered markers, nudged apart so none hides another; a leader joins a moved one to its place
const marks = [[1, ...LEAD.at]];
ROWS.forEach((r, i) => { if (r[2] !== null) marks.push([i + 2, r[2], r[3]]); });
const MR = 10.5;
const pts = marks.map(([n, lo, la]) => { const [px, py] = proj(lo, la); return { n, ox: px, oy: py, x: px, y: py }; });
for (let it = 0; it < 200; it++)
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      const need = 2 * MR + 3;
      if (d >= need) continue;
      if (d < 1e-6) { dx = 1; dy = 0.3; d = Math.hypot(dx, dy); }
      const push = (need - d) / 2;
      a.x -= (dx / d) * push; a.y -= (dy / d) * push;
      b.x += (dx / d) * push; b.y += (dy / d) * push;
    }
for (const p of pts) { p.x = Math.min(MX + MW - MR - 2, Math.max(MX + MR + 2, p.x)); p.y = Math.min(MY + MH - MR - 2, Math.max(MY + MR + 2, p.y)); }
for (const p of pts) if (Math.hypot(p.x - p.ox, p.y - p.oy) > 3) { line(p.ox, p.oy, p.x, p.y, 1.4, INK); disc(p.ox, p.oy, 2.2, INK); }
for (const p of pts) { disc(p.x, p.y, MR + 1.5, WHITE); badge(p.n, p.x, p.y, MR, p.n === 1 ? INK : RED); }
y = MY + MH + 14;

// the stories: two columns of one-line headlines, each with its number and section icon
// each headline as large as fits, at most 20 px cap height, letters set a touch tighter
const GAP = 20, CW = (W - 2 * M - GAP) / 2, TXO = 60, TR = -0.35;
ROWS.forEach(([cat, head], i) => {
  const col = i < NROW ? 0 : 1, row = i < NROW ? i : i - NROW;
  const x = M + col * (CW + GAP), ry = y + row * ROWH;
  badge(i + 2, x + 11, ry + 11, 11, RED);
  icon(cat, x + 29, ry + 1, 21);
  const hsize = fit(head, 20, BOLD, CW - TXO - 10, TR);
  text(head, x + TXO, ry + 1 + (20 - hsize) / 2, hsize, INK, BOLD, TR);
});
rect(M + CW + GAP / 2, y - 4, 1, NROW * ROWH - 4, [170, 164, 150]);

// ---------- PNG ----------
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
for (let yy = 0; yy < H; yy++)
  for (let x = 0; x < W * 3; x++) raw[yy * (1 + W * 3) + 1 + x] = Math.max(0, Math.min(255, Math.round(img[yy * W * 3 + x])));
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.png'), png);
