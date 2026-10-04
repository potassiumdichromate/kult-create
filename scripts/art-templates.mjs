// Generates the art-direction templates in docs/art/templates/ (no deps).
// Run: node scripts/art-templates.mjs
//
// Every template is drawn at the office's "2x" asset scale: one isometric
// floor tile is 64x32 px (the live renderer uses 32x16 and will draw 2x
// assets at half size, so new art has twice the detail of today's shapes).

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "art", "templates");
mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ raster + PNG
class Img {
  constructor(w, h, bg = "#000000") { this.w = w; this.h = h; this.px = Buffer.alloc(w * h * 4); this.fill(bg); }
  static rgba(hex, a = 255) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255, a]; }
  set(x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4, a = c[3] / 255;
    this.px[i] = this.px[i] * (1 - a) + c[0] * a; this.px[i + 1] = this.px[i + 1] * (1 - a) + c[1] * a;
    this.px[i + 2] = this.px[i + 2] * (1 - a) + c[2] * a; this.px[i + 3] = 255;
  }
  fill(hex) { const c = Img.rgba(hex); for (let i = 0; i < this.px.length; i += 4) this.px.set(c, i); }
  rect(x, y, w, h, hex, a) { const c = Img.rgba(hex, a); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  frame(x, y, w, h, hex, t = 2) { this.rect(x, y, w, t, hex); this.rect(x, y + h - t, w, t, hex); this.rect(x, y, t, h, hex); this.rect(x + w - t, y, t, h, hex); }
  line(x0, y0, x1, y1, hex, t = 1, dash = 0) {
    const c = Img.rgba(hex), n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= n; s++) {
      if (dash && Math.floor(s / dash) % 2) continue;
      const x = x0 + ((x1 - x0) * s) / n, y = y0 + ((y1 - y0) * s) / n;
      for (let i = 0; i < t; i++) for (let j = 0; j < t; j++) this.set(x + i - (t >> 1), y + j - (t >> 1), c);
    }
  }
  poly(pts, hex, a) { // even-odd scanline fill
    const c = Img.rgba(hex, a), ys = pts.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= y + 0.5 && by > y + 0.5) || (by <= y + 0.5 && ay > y + 0.5)) xs.push(ax + ((y + 0.5 - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, c);
    }
  }
  outline(pts, hex, t = 2, dash = 0) { for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; this.line(a[0], a[1], b[0], b[1], hex, t, dash); } }
  text(str, x, y, scale, hex, align = "left") {
    const s = String(str).toUpperCase(), adv = 6 * scale, width = s.length * adv - scale;
    let cx = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    const c = Img.rgba(hex);
    for (const ch of s) {
      const g = FONT[ch] || FONT["?"];
      for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
        if (g[row] >> (4 - col) & 1) for (let i = 0; i < scale; i++) for (let j = 0; j < scale; j++) this.set(cx + col * scale + i, y + row * scale + j, c);
      }
      cx += adv;
    }
  }
  png() {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) { raw[y * (this.w * 4 + 1)] = 0; this.px.copy(raw, y * (this.w * 4 + 1) + 1, y * this.w * 4, (y + 1) * this.w * 4); }
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
  }
  save(name) { writeFileSync(join(OUT, name), this.png()); console.log("wrote", name, `${this.w}x${this.h}`); }
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return c ^ -1; };

// 5x7 bitmap font (rows, 5 bits each).
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [30, 1, 1, 14, 1, 1, 30],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  " ": [0, 0, 0, 0, 0, 0, 0], ".": [0, 0, 0, 0, 0, 12, 12], ":": [0, 12, 12, 0, 12, 12, 0], "-": [0, 0, 0, 31, 0, 0, 0],
  "/": [1, 1, 2, 4, 8, 16, 16], "(": [2, 4, 8, 8, 8, 4, 2], ")": [8, 4, 2, 2, 2, 4, 8], "#": [10, 10, 31, 10, 31, 10, 10],
  "X_": [17, 10, 4, 10, 17, 0, 0], "?": [14, 17, 1, 2, 4, 0, 4], "'": [4, 4, 8, 0, 0, 0, 0], ",": [0, 0, 0, 0, 12, 4, 8],
  "+": [0, 4, 4, 31, 4, 4, 0], "=": [0, 0, 31, 0, 31, 0, 0], "%": [24, 25, 2, 4, 8, 19, 3]
};
FONT["×"] = FONT.X_;

// ------------------------------------------------------------------ shared style
const BG = "#ff00ff";            // chroma background the importer will key out
const GUIDE = "#1a1033";         // guide lines on magenta
const PAL = [
  ["Night sky", "#1a1033"], ["Wall left", "#2e2457"], ["Wall right", "#3a2f6e"], ["Wall trim", "#56489a"],
  ["Floor wood", "#74513f"], ["Floor wood dark", "#6b4a3a"], ["Desk top", "#c8a27a"], ["Chair", "#4b4275"],
  ["Monitor", "#2a2a3a"], ["Screen glow", "#7ee0ff"], ["KULT pink", "#ff7eb6"], ["KULT blue", "#5ec8f2"],
  ["Green", "#7ee081"], ["Gold", "#f2c14e"], ["Orange", "#ff9f5a"], ["Coral", "#f78c6b"],
  ["Lilac", "#c792ea"], ["Periwinkle", "#9fa8ff"], ["Mint", "#4dd4ac"], ["Butter", "#ffd166"],
  ["Ink outline", "#120d26"], ["Paper", "#fffdf5"]
];

// Isometric projection at 2x: tile 64x32.
const isoAt = (ox, oy, s = 1) => (gx, gy, z = 0) => [ox + (gx - gy) * 32 * s, oy + (gx + gy) * 16 * s - z * s];

// ------------------------------------------------------------------ 1. office layout (1536x1024)
// The office background is 1280x640 at 2x. ChatGPT outputs 1536x1024, so the
// guide shows that room scaled 1.2x and centred (bands of 128 px top/bottom);
// the importer crops the band and scales it back.
const OFFICE_SCALE = 1.2;
function officeLayout(annotated) {
  const img = new Img(1536, 1024, "#1a1033");
  const isoS = isoAt(608 * OFFICE_SCALE, 160 * OFFICE_SCALE + 128, OFFICE_SCALE);
  const iso = (gx, gy, z = 0) => isoS(gx, gy, z);
  const ROOMX = 14, ROOMY = 12, WALL = 140;
  // Walls
  img.poly([iso(0, 0, WALL), iso(0, ROOMY, WALL), iso(0, ROOMY, 0), iso(0, 0, 0)], "#2e2457");
  img.poly([iso(0, 0, WALL), iso(ROOMX, 0, WALL), iso(ROOMX, 0, 0), iso(0, 0, 0)], "#3a2f6e");
  // Floor checker
  for (let x = 0; x < ROOMX; x++) for (let y = 0; y < ROOMY; y++) {
    img.poly([iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], (x + y) % 2 ? "#6b4a3a" : "#74513f");
  }
  for (let x = 0; x <= ROOMX; x++) img.line(...iso(x, 0), ...iso(x, ROOMY), "#5a3d30", 1);
  for (let y = 0; y <= ROOMY; y++) img.line(...iso(0, y), ...iso(ROOMX, y), "#5a3d30", 1);
  img.outline([iso(0, 0, WALL), iso(0, ROOMY, WALL), iso(0, ROOMY), iso(0, 0)], "#ece8ff", 2);
  img.outline([iso(0, 0, WALL), iso(ROOMX, 0, WALL), iso(ROOMX, 0), iso(0, 0)], "#ece8ff", 2);
  img.outline([iso(0, 0), iso(ROOMX, 0), iso(ROOMX, ROOMY), iso(0, ROOMY)], "#ece8ff", 2);

  // Wall props (dashed): left wall gx=0 spans gy; right wall gy=0 spans gx. Heights in 2x px.
  const wallL = (y0, y1, z0, z1) => [iso(0, y0, z1), iso(0, y1, z1), iso(0, y1, z0), iso(0, y0, z0)];
  const wallR = (x0, x1, z0, z1) => [iso(x0, 0, z1), iso(x1, 0, z1), iso(x1, 0, z0), iso(x0, 0, z0)];
  const props = [
    [wallL(1.6, 3.8, 42, 114), "WINDOW", "#5ec8f2"], [wallL(8.4, 10.6, 42, 114), "WINDOW", "#5ec8f2"],
    [wallL(4.8, 7.6, 40, 116), "WHITEBOARD", "#e8e8f0"],
    [wallR(1.3, 3.1, 48, 116), "CEO PORTRAIT", "#f2c14e"], [wallR(3.5, 3.9, 92, 108), "", "#e8e8f0"],
    [wallR(4.4, 9.6, 32, 116), "BIG SCREEN", "#7ee0ff"], [wallR(10.6, 13.4, 68, 116), "NEON SIGN", "#ff7eb6"]
  ];
  for (const [pts, label, color] of props) {
    img.outline(pts, color, 2, 6);
    if (annotated && label) { const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4; img.text(label, cx, cy - 6, 2, color, "center"); }
  }
  // Rugs (floor paint) and desk spots (separate sprites; keep floor plain there).
  const rug = (x0, y0, x1, y1) => [iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)];
  if (annotated) {
    img.outline(rug(4.6, 0.6, 9.4, 2.7), "#c792ea", 2, 8);
    img.text("CEO RUG", ...iso(8.6, 1.9).map((v, i) => (i ? v - 6 : v)), 2, "#c792ea", "center");
    const DESKS = { PRODUCER: [2.2, 4], DESIGNER: [4.6, 4], "ART DIR": [7.4, 4], ILLUSTR: [9.8, 4], "BG ART": [12.2, 4], ENGINEER: [2.2, 8], QA: [4.6, 8], PLAYTEST: [7.0, 8], MARKETING: [9.8, 8], PUBLISHER: [12.2, 8] };
    for (const [name, [x, y]] of Object.entries(DESKS)) {
      img.outline(rug(x - 1, y - 0.45, x + 1, y + 0.45), "#ffd166", 2, 5);
      const [cx, cy] = iso(x, y);
      img.text(name, cx, cy - 6, 2, "#ffd166", "center");
    }
    for (const [x, y, label] of [[0.7, 11.3, "PLANT"], [13.3, 0.7, "PLANT"], [0.6, 0.6, "COOLER"], [13, 10.8, "COFFEE"], [6.15, 1.25, "PODIUM"]]) {
      img.outline(rug(x - 0.3, y - 0.3, x + 0.3, y + 0.3), "#7ee081", 2, 4);
      const [cx, cy] = iso(x, y); img.text(label, cx, cy + 10, 2, "#7ee081", "center");
    }
    img.text("KULT CREATE OFFICE - LAYOUT GUIDE (2X: TILE 64X32, WALL 140 PX)", 768, 920, 3, "#ece8ff", "center");
    img.text("DASHED = SEPARATE ASSETS. PAINT ONLY FLOOR + WALLS + RUGS IN THE BACKGROUND.", 768, 950, 2, "#a49cd0", "center");
    img.text("KEEP THE ROOM INSIDE THE MIDDLE BAND (Y 128-896)", 768, 40, 3, "#a49cd0", "center");
  }
  img.save(annotated ? "office-layout-annotated.png" : "office-layout-guide.png");
}

// ------------------------------------------------------------------ 2. character pose sheet (1536x1024)
function characterSheet(annotated) {
  const img = new Img(1536, 1024, BG);
  const cells = ["1 SITTING IDLE", "2 TYPING", "3 CHEER", "4 WALKING"];
  const cw = 384, ground = 880, top = 280, headBottom = 520; // frame 48x80 at 2x (x7.5): ~2.5 heads tall chibi
  cells.forEach((label, i) => {
    const x0 = i * cw, cx = x0 + cw / 2;
    if (i) img.rect(x0 - 1, 0, 3, 1024, GUIDE);
    img.line(cx, 120, cx, ground + 40, GUIDE, 1, 10);                 // centre line
    img.line(x0 + 40, ground, x0 + cw - 40, ground, GUIDE, 4);         // feet line
    img.line(x0 + 60, top, x0 + cw - 60, top, GUIDE, 2, 12);           // top of head
    img.line(x0 + 60, headBottom, x0 + cw - 60, headBottom, GUIDE, 2, 12); // chin
    img.outline([[cx - 180, top], [cx + 180, top], [cx + 180, ground], [cx - 180, ground]], GUIDE, 2, 16); // the 48x80 sprite frame
    if (i < 2) { img.rect(cx - 185, 700, 370, 14, "#120d26", 140); if (annotated) img.text("DESK EDGE (BELOW IS HIDDEN)", cx, 722, 2, GUIDE, "center"); }
    if (annotated) {
      img.text(label, cx, 40, 4, GUIDE, "center");
      img.text("HEAD", x0 + 70, top + 8, 2, GUIDE);
      img.text("FEET", x0 + 50, ground + 10, 2, GUIDE);
    }
  });
  if (annotated) img.text("ONE CHARACTER PER SHEET - SAME DESIGN IN ALL 4 POSES - FACING VIEWER (POSE 4: 3/4 WALK)", 768, 984, 2, GUIDE, "center");
  img.save(annotated ? "character-poses-annotated.png" : "character-poses-guide.png");
}

// ------------------------------------------------------------------ 3. furniture (1536x1024, 3x2 cells)
function furniture(annotated) {
  const img = new Img(1536, 1024, BG);
  const S = 3; // template scale over 2x art
  const items = [
    ["DESK + MONITOR", 2, 0.9, 28, 22],
    ["CHAIR (BACK VIEW)", 0.6, 0.6, 38, 0],
    ["CEO PODIUM", 0.9, 0.5, 36, 0],
    ["PLANT IN POT", 0.44, 0.44, 16, 44],
    ["WATER COOLER", 0.5, 0.5, 36, 20],
    ["COFFEE MACHINE", 1.1, 0.8, 32, 24]
  ];
  items.forEach(([label, w, d, h, extra], i) => {
    const col = i % 3, row = Math.floor(i / 3), x0 = col * 512, y0 = row * 512;
    img.frame(x0, y0, 512, 512, GUIDE, 2);
    const iso = isoAt(x0 + 256, y0 + 400, S);
    const fx = -w / 2, fy = -d / 2;
    const base = [iso(fx, fy), iso(fx + w, fy), iso(fx + w, fy + d), iso(fx, fy + d)];
    const topF = [iso(fx, fy, h), iso(fx + w, fy, h), iso(fx + w, fy + d, h), iso(fx, fy + d, h)];
    img.poly(base, "#120d26", 70);
    img.outline(base, GUIDE, 3);
    img.outline(topF, GUIDE, 2, 10);
    for (const [a, b] of [[base[1], topF[1]], [base[2], topF[2]], [base[3], topF[3]]]) img.line(a[0], a[1], b[0], b[1], GUIDE, 2, 10);
    if (extra) { const [tx, ty] = iso(0, 0, h + extra); img.line(tx, ty, tx, iso(0, 0, h)[1], GUIDE, 2, 6); img.rect(tx - 6, ty - 6, 12, 12, GUIDE); }
    if (annotated) {
      img.text(label, x0 + 256, y0 + 24, 3, GUIDE, "center");
      img.text(`FOOTPRINT ${w}X${d} TILES  HEIGHT ${h + extra}PX`, x0 + 256, y0 + 470, 2, GUIDE, "center");
    }
  });
  img.save(annotated ? "furniture-annotated.png" : "furniture-guide.png");
}

// ------------------------------------------------------------------ 4. wall props (1536x1024, flat front views)
function wallProps(annotated) {
  const img = new Img(1536, 1024, BG);
  const items = [
    ["WINDOW (NIGHT CITY)", 3, 2], ["WHITEBOARD", 3, 2], ["BIG SCREEN BEZEL", 2.36, 1],
    ["NEON SIGN KULT CREATE", 3.5, 1], ["PORTRAIT FRAME", 5, 6], ["WALL CLOCK", 1, 1]
  ];
  items.forEach(([label, rw, rh], i) => {
    const col = i % 3, row = Math.floor(i / 3), x0 = col * 512, y0 = row * 512;
    img.frame(x0, y0, 512, 512, GUIDE, 2);
    const maxW = 400, maxH = 340, k = Math.min(maxW / rw, maxH / rh), w = Math.round(rw * k), h = Math.round(rh * k);
    const x = x0 + (512 - w) / 2, y = y0 + 70 + (360 - h) / 2;
    img.frame(x, y, w, h, GUIDE, 4);
    if (label.startsWith("BIG SCREEN")) { img.rect(x + 18, y + 18, w - 36, h - 36, "#000000"); if (annotated) img.text("KEEP BLACK (LIVE SCREEN)", x + w / 2, y + h / 2 - 6, 2, "#7ee0ff", "center"); }
    if (label.startsWith("PORTRAIT")) { img.rect(x + 30, y + 30, w - 60, h - 60, "#000000"); if (annotated) img.text("KEEP BLACK (CEO PHOTO)", x + w / 2, y + h / 2 - 6, 2, "#f2c14e", "center"); }
    if (annotated) {
      img.text(label, x0 + 256, y0 + 24, 3, GUIDE, "center");
      img.text(`FLAT FRONT VIEW  RATIO ${rw}:${rh}`, x0 + 256, y0 + 470, 2, GUIDE, "center");
    }
  });
  img.save(annotated ? "wall-props-annotated.png" : "wall-props-guide.png");
}

// ------------------------------------------------------------------ 5. palette
function palette() {
  const cols = 6, sw = 200, sh = 150, pad = 16;
  const rows = Math.ceil(PAL.length / cols);
  const img = new Img(cols * (sw + pad) + pad, rows * (sh + pad) + pad + 60, "#0b0717");
  img.text("KULT CREATE PALETTE", img.w / 2, 18, 4, "#ece8ff", "center");
  PAL.forEach(([name, hex], i) => {
    const x = pad + (i % cols) * (sw + pad), y = 70 + Math.floor(i / cols) * (sh + pad);
    img.rect(x, y, sw, sh - 40, hex);
    img.frame(x, y, sw, sh - 40, "#000000", 3);
    img.text(name, x + 4, y + sh - 34, 2, "#ece8ff");
    img.text(hex, x + 4, y + sh - 16, 2, "#a49cd0");
  });
  img.save("palette.png");
}

officeLayout(true); officeLayout(false);
characterSheet(true); characterSheet(false);
furniture(true); furniture(false);
wallProps(true); wallProps(false);
palette();
