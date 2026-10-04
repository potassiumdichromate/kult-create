// Imports the ChatGPT art (see docs/art/ART_DIRECTION.md) into office sprites.
//
//   node scripts/import-art.mjs [rawDir]      (default: public/office/art/raw)
//
// Writes public/office/art/*.png and public/office/art/manifest.json, which the
// office renderer loads; anything missing keeps the drawn look.
//
// - office-background.png: scaled to the office canvas (768x512). The floor
//   corners and wall pieces were measured once on the delivered image
//   (CALIBRATION below); re-measure if the background is regenerated.
// - furniture.png / ui.png: dark glowing background removed by a flood fill
//   from each cell's border, then scaled and given a 1px outline.
// - char-<id>.png: transparent sheets; the 4 poses are found by column gaps,
//   scaled together so every character has the same size, and laid out as a
//   4-frame strip anchored at the feet.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPng, writePng, blank } from "./png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = process.argv[2] || join(ROOT, "public", "office", "art", "raw");
const OUT = join(ROOT, "public", "office", "art");
mkdirSync(OUT, { recursive: true });

const CANVAS = { width: 768, height: 512 };   // office canvas when the art is used
const BG_SCALE = 0.5;                          // 1536x1024 background -> canvas

// Measured on office-background.png (1536x1024 image pixels).
const CALIBRATION = {
  floor: { back: [760, 255], left: [116, 604], right: [1420, 630], front: [776, 979] },
  wallHeight: 215,                             // floor-to-top-trim at the back corner
  screen: { tl: [978, 197], tr: [1215, 324], bl: [978, 334], br: [1215, 463] },
  portrait: { tl: [821, 122], tr: [878, 153], bl: [821, 227], br: [878, 259] },
  whiteboard: { tl: [359, 295], tr: [514, 217], bl: [359, 405], br: [514, 325] },
  neon: { tl: [1262, 347], tr: [1406, 423], bl: [1262, 443], br: [1406, 518] },   // measured by eye (uneven shading)
  rugCenter: [975, 492]
};

// Target sizes on the canvas (px).
const SIZES = {
  furniture: { desk: 78, chair: 34, podium: 30, plant: 30, cooler: 24, coffee: 40 }, // widths
  characterWalkHeight: 54,
  icon: 48
};
const FURNITURE_ORDER = ["desk", "chair", "podium", "plant", "cooler", "coffee"];
const UI_ORDER = ["emblem", "coin", "office", "dashboard", "games", "credits", "studio", "done", "error"];
const CHARACTERS = ["ceo", "producer", "designer", "artdirector", "illustrator", "background", "marketing", "engineer", "qa", "playtester", "publisher"];
const POSES = ["idle", "typing", "cheer", "walk"];

const manifest = { version: 1, canvas: CANVAS, background: null, sprites: {}, characters: {}, icons: {} };

// ------------------------------------------------------------------ image helpers
const at = (img, x, y) => (y * img.width + x) * 4;

function crop(img, x0, y0, w, h) {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) img.data.copy(out.data, y * w * 4, at(img, x0, y0 + y), at(img, x0, y0 + y) + w * 4);
  return out;
}

// Area-average downscale with premultiplied alpha.
function resize(img, w, h) {
  const out = blank(w, h), sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = Math.floor(y * sy); yy < Math.min(img.height, Math.ceil((y + 1) * sy)); yy++) {
      for (let xx = Math.floor(x * sx); xx < Math.min(img.width, Math.ceil((x + 1) * sx)); xx++) {
        const o = at(img, xx, yy), al = img.data[o + 3] / 255;
        r += img.data[o] * al; g += img.data[o + 1] * al; b += img.data[o + 2] * al; a += al; n++;
      }
    }
    const o = at(out, x, y);
    if (a > 0) { out.data[o] = r / a; out.data[o + 1] = g / a; out.data[o + 2] = b / a; }
    out.data[o + 3] = Math.round((a / n) * 255);
  }
  return out;
}

// Crisp pixel-art edges: alpha becomes fully on or off.
function hardenAlpha(img, threshold = 120) {
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] >= threshold ? 255 : 0;
  return img;
}

// 1px dark outline around opaque pixels (for cut-out sprites that lost theirs).
function outline(img, rgb = [18, 13, 38]) {
  const out = blank(img.width + 2, img.height + 2);
  for (let y = 0; y < img.height; y++) img.data.copy(out.data, at(out, 1, y + 1), at(img, 0, y), at(img, 0, y) + img.width * 4);
  const solid = (x, y) => x >= 0 && y >= 0 && x < out.width && y < out.height && out.data[at(out, x, y) + 3] > 0;
  const edge = [];
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    if (!solid(x, y) && (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1))) edge.push([x, y]);
  }
  for (const [x, y] of edge) { const o = at(out, x, y); out.data[o] = rgb[0]; out.data[o + 1] = rgb[1]; out.data[o + 2] = rgb[2]; out.data[o + 3] = 255; }
  return out;
}

// Bounding box of opaque pixels.
function bbox(img, minAlpha = 40) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.data[at(img, x, y) + 3] >= minAlpha) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Removes a dark (glowing) background: flood fill from the image border over
// pixels darker than `maxBright` in every channel.
function keyDarkBackground(img, maxBright = 78) {
  const { width: W, height: H } = img, seen = new Uint8Array(W * H), stack = [];
  for (let x = 0; x < W; x++) stack.push(x, 0, x, H - 1);
  for (let y = 0; y < H; y++) stack.push(0, y, W - 1, y);
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H || seen[y * W + x]) continue;
    const o = at(img, x, y);
    if (Math.max(img.data[o], img.data[o + 1], img.data[o + 2]) > maxBright) continue;
    seen[y * W + x] = 1;
    img.data[o + 3] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return img;
}

// True when the sheet already has a transparent background (ChatGPT's
// "transparent" output: glow colours are left in RGB but alpha is 0).
function isTransparent(img) {
  let clear = 0;
  for (let i = 3; i < img.data.length; i += 4 * 16) if (img.data[i] < 10) clear++;
  return clear / (img.data.length / (4 * 16)) > 0.2;
}
function dropHaze(img, min = 60) {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < min) img.data[i] = 0;
  return img;
}

// Removes a flat surround colour: flood fill from the image border over
// pixels within `tol` of the corner colour. The room's near-black outline is
// far enough from the violet surround to survive.
function keyFlatSurround(img, tol = 24) {
  const { width: W, height: H } = img, seen = new Uint8Array(W * H), stack = [];
  const c = [img.data[0], img.data[1], img.data[2]];
  for (let x = 0; x < W; x++) stack.push(x, 0, x, H - 1);
  for (let y = 0; y < H; y++) stack.push(0, y, W - 1, y);
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H || seen[y * W + x]) continue;
    const o = at(img, x, y);
    if (Math.abs(img.data[o] - c[0]) + Math.abs(img.data[o + 1] - c[1]) + Math.abs(img.data[o + 2] - c[2]) > tol) continue;
    seen[y * W + x] = 1;
    img.data.fill(0, o, o + 4); // fully clear (zeroed colour also compresses far better)
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return img;
}

// Rounds colours to 5 bits per channel: invisible on this painted pixel art,
// and it makes the PNG about 4x smaller (1.2 MB -> ~330 KB for the room).
// Small contrast + saturation lift so detail survives at sprite size.
function punch(img, contrast = 1.18, saturation = 1.2) {
  for (let i = 0; i < img.data.length; i += 4) {
    if (!img.data[i + 3]) continue;
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2], l = 0.299 * r + 0.587 * g + 0.114 * b;
    for (const [k, v] of [[0, r], [1, g], [2, b]]) {
      const sat = l + (v - l) * saturation;
      img.data[i + k] = Math.max(0, Math.min(255, (sat - 128) * contrast + 128));
    }
  }
  return img;
}

function posterize(img, bits = 5) {
  const mask = (0xff << (8 - bits)) & 0xff, half = (1 << (8 - bits)) >> 1;
  for (let i = 0; i < img.data.length; i += 4) {
    if (!img.data[i + 3]) continue;
    for (let c = 0; c < 3; c++) img.data[i + c] = Math.min(255, (img.data[i + c] & mask) + half);
  }
  return img;
}

const save = (name, img) => { writePng(join(OUT, name), img); return name; };
const raw = (name) => (existsSync(join(RAW, name)) ? readPng(join(RAW, name)) : null);
const scalePt = ([x, y]) => [+(x * BG_SCALE).toFixed(1), +(y * BG_SCALE).toFixed(1)];

// ------------------------------------------------------------------ background
{
  const img = raw("office-background.png");
  if (img) {
    // Full resolution (the office draws on a 2x canvas, so the room stays
    // sharp), with the flat violet surround cut out so the room floats on the page.
    const full = img.width === CANVAS.width * 2 ? img : resize(img, CANVAS.width * 2, CANVAS.height * 2);
    save("office.png", posterize(keyFlatSurround(full)));
    const c = CALIBRATION, f = c.floor;
    const quad = (q) => ({ tl: scalePt(q.tl), tr: scalePt(q.tr), bl: scalePt(q.bl), br: scalePt(q.br) });
    manifest.background = {
      file: "office.png",
      // Grid (gx along the right wall, 0..14; gy along the left wall, 0..12) to canvas.
      projection: {
        origin: scalePt(f.back),
        ex: [+((f.right[0] - f.back[0]) / 14 * BG_SCALE).toFixed(3), +((f.right[1] - f.back[1]) / 14 * BG_SCALE).toFixed(3)],
        ey: [+((f.left[0] - f.back[0]) / 12 * BG_SCALE).toFixed(3), +((f.left[1] - f.back[1]) / 12 * BG_SCALE).toFixed(3)],
        zScale: +((c.wallHeight * BG_SCALE) / 70).toFixed(3)   // the drawn office's wall is 70 units tall
      },
      screen: quad(c.screen), portrait: quad(c.portrait), whiteboard: quad(c.whiteboard), neon: quad(c.neon),
      rugCenter: scalePt(c.rugCenter)
    };
    console.log("background: office.png", CANVAS.width * 2 + "x" + CANVAS.height * 2);
  }
}

// ------------------------------------------------------------------ furniture + UI (grid sheets)
// Connected shapes (8-connected, alpha >= 60). Returns per-shape pixel lists.
function components(img) {
  const { width: W, height: H } = img, label = new Int32Array(W * H).fill(-1), comps = [];
  for (let y0 = 0; y0 < H; y0++) for (let x0 = 0; x0 < W; x0++) {
    if (label[y0 * W + x0] !== -1 || img.data[at(img, x0, y0) + 3] < 60) continue;
    const id = comps.length, stack = [x0, y0], pix = [];
    label[y0 * W + x0] = id;
    let minx = x0, maxx = x0, miny = y0, maxy = y0;
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      pix.push(y * W + x);
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || label[ny * W + nx] !== -1 || img.data[at(img, nx, ny) + 3] < 60) continue;
        label[ny * W + nx] = id; stack.push(nx, ny);
      }
    }
    comps.push({ pix, minx, maxx, miny, maxy, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 });
  }
  return comps;
}

// Each named object = the biggest shape whose centre falls in its grid cell,
// plus any small shapes (sparkles, loose bits) lying inside its bounds.
function gridSheet(file, cols, rows, names, sizeOf) {
  const img = raw(file);
  if (!img) return;
  const transparent = isTransparent(img);
  const work = { width: img.width, height: img.height, data: Buffer.from(img.data) };
  if (transparent) dropHaze(work); else keyDarkBackground(work);
  const comps = components(work);
  const cw = img.width / cols, ch = img.height / rows;
  names.forEach((name, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const inCell = comps.filter((c) => c.cx >= col * cw && c.cx < (col + 1) * cw && c.cy >= row * ch && c.cy < (row + 1) * ch);
    const main = inCell.sort((a, b) => b.pix.length - a.pix.length)[0];
    if (!main) { console.warn(`${file}: no object found for ${name}`); return; }
    const parts = comps.filter((c) => c === main || (c.pix.length < main.pix.length * 0.05 && c.minx >= main.minx - 10 && c.maxx <= main.maxx + 10 && c.miny >= main.miny - 10 && c.maxy <= main.maxy + 10));
    const x0 = Math.min(...parts.map((p) => p.minx)), y0 = Math.min(...parts.map((p) => p.miny));
    const w0 = Math.max(...parts.map((p) => p.maxx)) - x0 + 1, h0 = Math.max(...parts.map((p) => p.maxy)) - y0 + 1;
    const obj = blank(w0, h0);
    for (const p of parts) for (const k of p.pix) {
      const x = k % img.width, y = Math.floor(k / img.width);
      work.data.copy(obj.data, ((y - y0) * w0 + (x - x0)) * 4, k * 4, k * 4 + 4);
    }
    const { w, h } = sizeOf(name, { w: w0, h: h0 });
    const scaled = hardenAlpha(resize(obj, w, h));
    const sprite = transparent ? scaled : outline(scaled); // keyed art lost its outline
    const fileName = `${file.replace(".png", "")}-${name}.png`;
    save(fileName, sprite);
    const entry = { file: fileName, w: sprite.width, h: sprite.height, anchor: [sprite.width / 2, sprite.height - 1] };
    if (file === "ui.png") manifest.icons[name] = entry; else manifest.sprites[name] = entry;
    console.log(`${file}: ${name} ${sprite.width}x${sprite.height}`);
  });
}
gridSheet("furniture.png", 3, 2, FURNITURE_ORDER, (name, b) => {
  const w = SIZES.furniture[name];
  return { w, h: Math.max(1, Math.round((b.h / b.w) * w)) };
});
gridSheet("ui.png", 3, 3, UI_ORDER, (_n, b) => {
  const s = SIZES.icon / Math.max(b.w, b.h);
  return { w: Math.max(1, Math.round(b.w * s)), h: Math.max(1, Math.round(b.h * s)) };
});

// ------------------------------------------------------------------ characters
function splitPoses(img) {
  // Columns with solid pixels; poses are runs separated by wide empty gaps.
  // (ChatGPT leaves faint alpha haze between figures, so only count solid
  // pixels, and need a few per column.)
  const used = new Array(img.width).fill(false);
  for (let x = 0; x < img.width; x++) {
    let n = 0;
    for (let y = 0; y < img.height; y++) if (img.data[at(img, x, y) + 3] > 200 && ++n >= 3) { used[x] = true; break; }
  }
  const runs = [];
  for (let x = 0; x < img.width;) {
    if (!used[x]) { x++; continue; }
    let e = x; while (e < img.width && (used[e] || used.slice(e, e + 24).some(Boolean))) e++;
    runs.push([x, e]); x = e;
  }
  // Merge tiny runs (sparkles) into their neighbour until 4 remain.
  while (runs.length > 4) {
    let k = 0; for (let i = 1; i < runs.length; i++) if (runs[i][1] - runs[i][0] < runs[k][1] - runs[k][0]) k = i;
    const j = k === 0 ? 1 : k === runs.length - 1 ? k - 1 : (runs[k][0] - runs[k - 1][1] < runs[k + 1][0] - runs[k][1] ? k - 1 : k + 1);
    runs[j] = [Math.min(runs[j][0], runs[k][0]), Math.max(runs[j][1], runs[k][1])];
    runs.splice(k, 1);
  }
  // Fallback: the sheets are laid out as 4 equal columns.
  const bands = runs.length === 4 ? runs : [0, 1, 2, 3].map((i) => [Math.round((i * img.width) / 4), Math.round(((i + 1) * img.width) / 4)]);
  return bands.map(([x0, x1]) => {
    const band = crop(img, x0, 0, x1 - x0, img.height);
    for (let i = 3; i < band.data.length; i += 4) if (band.data[i] < 60) band.data[i] = 0; // drop the haze
    const b = bbox(band, 60);
    return crop(band, b.x, b.y, b.w, b.h);
  });
}

for (const id of CHARACTERS) {
  const img = raw(`char-${id}.png`);
  if (!img) continue;
  const poses = splitPoses(img);
  const scale = SIZES.characterWalkHeight / poses[3].height;
  const scaled = poses.map((p) => hardenAlpha(resize(p, Math.max(1, Math.round(p.width * scale)), Math.max(1, Math.round(p.height * scale)))));
  const fw = Math.max(...scaled.map((p) => p.width)), fh = Math.max(...scaled.map((p) => p.height));
  const strip = blank(fw * 4, fh);
  scaled.forEach((p, i) => {
    const ox = i * fw + Math.floor((fw - p.width) / 2), oy = fh - p.height; // bottom-centre aligned
    for (let y = 0; y < p.height; y++) p.data.copy(strip.data, at(strip, ox, oy + y), y * p.width * 4, (y + 1) * p.width * 4);
  });
  save(`char-${id}.png`, strip);
  manifest.characters[id] = { file: `char-${id}.png`, frame: [fw, fh], anchor: [fw / 2, fh - 1], poses: POSES };
  console.log(`char-${id}: 4 frames of ${fw}x${fh}`);
}

// ------------------------------------------------------------------ CEO (one sheet per archetype)
// The CEO is the player's KULT agent, drawn from its archetype's AI Arena
// sheet (Berserker.png, Tactician.png, ...). Every sheet follows the same
// layout: face icons, a turnaround row (front view first), a walk-cycle row,
// then more poses. We take the front idle frame, the next turnaround frame
// (a "glance"), the whole walk cycle, and the portrait bust for the wall.
// Frames are stored at true pixel size (drawn 1:1 like the staff, so they keep
// the chunky pixel look), slightly taller than the staff, colours rounded to
// crisp pixel tones.
const ARCHETYPES = ["berserker", "tactician", "defender", "assassin", "support", "hybrid"];
const CEO_HEIGHT = 64; // canvas px: a bit taller than the staff (~56)

// Solid pixels: alpha >= 200, or (opaque sheets with a painted checkerboard)
// everything except light neutral greys connected to the border.
function ceoSolid(img) {
  const { width: W, height: H, data } = img;
  const mask = new Uint8Array(W * H);
  let solidA = 0, n = 0;
  for (let i = 3; i < data.length; i += 4 * 97) { n++; if (data[i] > 250) solidA++; }
  const opaque = solidA / n > 0.98;
  if (!opaque) { for (let i = 0; i < W * H; i++) mask[i] = data[i * 4 + 3] >= 200 ? 1 : 0; return { mask, opaque }; }
  mask.fill(1);
  const checker = (o) => { const mx = Math.max(data[o], data[o + 1], data[o + 2]), mn = Math.min(data[o], data[o + 1], data[o + 2]); return mn > 150 && mx - mn < 22; };
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, 0, x, H - 1);
  for (let y = 0; y < H; y++) stack.push(0, y, W - 1, y);
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const k = y * W + x;
    if (!mask[k] || !checker(k * 4)) continue;
    mask[k] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return { mask, opaque };
}

function maskComponents(mask, W, H) {
  const label = new Int32Array(W * H).fill(-1), out = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || label[s] !== -1) continue;
    const id = out.length, st = [s], pix = [];
    label[s] = id;
    let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
    while (st.length) {
      const k = st.pop(), x = k % W, y = (k - x) / W;
      pix.push(k);
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (const nk of [k - 1, k + 1, k - W, k + W]) if (nk >= 0 && nk < W * H && mask[nk] && label[nk] === -1 && Math.abs((nk % W) - x) <= 1) { label[nk] = id; st.push(nk); }
    }
    out.push({ id, pix, minx, maxx, miny, maxy, w: maxx - minx + 1, h: maxy - miny + 1, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 });
  }
  return out;
}

// One figure (component pixels only, so neighbours never bleed in).
function figure(img, mask, c) {
  const out = blank(c.w, c.h);
  for (const k of c.pix) {
    const x = k % img.width, y = (k - x) / img.width, o = ((y - c.miny) * c.w + (x - c.minx)) * 4;
    img.data.copy(out.data, o, k * 4, k * 4 + 3);
    out.data[o + 3] = 255;
  }
  return out;
}

for (const arch of ARCHETYPES) {
  const name = arch[0].toUpperCase() + arch.slice(1) + ".png";
  const img = raw(name);
  if (!img) continue;
  const { mask, opaque } = ceoSolid(img);
  const comps = maskComponents(mask, img.width, img.height);
  // Figure-sized shapes right of the portrait, grouped into rows.
  const figs = comps.filter((c) => c.h >= 80 && c.h <= 150 && c.w >= 40 && c.w <= 130 && c.pix.length > 1500 && c.minx > 300).sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const f of figs) { const r = rows.find((q) => Math.abs(q.cy - f.cy) < 40); if (r) { r.items.push(f); r.cy = (r.cy * (r.items.length - 1) + f.cy) / r.items.length; } else rows.push({ cy: f.cy, items: [f] }); }
  rows.forEach((r) => r.items.sort((a, b) => a.cx - b.cx));
  // Row 0 = face icons (square), row 1 = turnaround (tall), row 2 = walk cycle.
  const body = rows.filter((r) => r.items.length >= 8 && r.items[0].h / r.items[0].w > 1.3);
  const turn = body[0], walkRow = rows[rows.indexOf(turn) + 1];
  if (!turn || !walkRow || walkRow.items.length < 6) { console.warn(`${name}: layout not recognised; skipped`); continue; }
  // The first 5 walk frames are side-on on every sheet (later ones can turn away).
  const frames = [turn.items[0], turn.items[1], ...walkRow.items.slice(0, 5)].map((c) => figure(img, mask, c));
  const scale = CEO_HEIGHT / turn.items[0].h;
  const scaled = frames.map((f) => outline(posterize(punch(hardenAlpha(resize(f, Math.max(1, Math.round(f.width * scale)), Math.max(1, Math.round(f.height * scale))))), 5)));
  const fw = Math.max(...scaled.map((p) => p.width)), fh = Math.max(...scaled.map((p) => p.height));
  const strip = blank(fw * scaled.length, fh);
  scaled.forEach((p, i) => {
    const ox = i * fw + Math.floor((fw - p.width) / 2), oy = fh - p.height;
    for (let y = 0; y < p.height; y++) p.data.copy(strip.data, at(strip, ox, oy + y), y * p.width * 4, (y + 1) * p.width * 4);
  });
  save(`ceo-${arch}.png`, strip);

  // Portrait bust (top-left): crop to the tall wall frame (about 5:9), on dark.
  const bust = comps.filter((c) => c.maxx < 380 && c.maxy < 420 && c.w > 200).sort((a, b) => b.pix.length - a.pix.length)[0];
  let portrait = null;
  if (bust) {
    const ph = bust.h, pw = Math.min(bust.w, Math.round(ph * 0.62));
    const px0 = Math.round(bust.cx - pw / 2);
    const crop = blank(pw, ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const sx = px0 + x, sy = bust.miny + y, o = (y * pw + x) * 4, s = (sy * img.width + sx) * 4;
      const a = opaque ? (mask[sy * img.width + sx] ? 1 : 0) : img.data[s + 3] / 255; // painted checkerboard -> dark
      crop.data[o] = img.data[s] * a + 18 * (1 - a); crop.data[o + 1] = img.data[s + 1] * a + 13 * (1 - a); crop.data[o + 2] = img.data[s + 2] * a + 38 * (1 - a); crop.data[o + 3] = 255;
    }
    portrait = `ceo-${arch}-portrait.png`;
    save(portrait, resize(crop, 120, Math.round((ph / pw) * 120)));
  }
  manifest.ceo ??= {};
  manifest.ceo[arch] = {
    file: `ceo-${arch}.png`, frame: [fw, fh], scale: 1, anchor: [fw / 2, fh - 1], walkFaces: "right",
    poses: ["idle", "glance", ...Array.from({ length: scaled.length - 2 }, (_, i) => `walk${i + 1}`)],
    portrait
  };
  console.log(`ceo-${arch}: ${scaled.length} frames of ${fw}x${fh}${portrait ? " + portrait" : ""}`);
}

// Revision = hash of every sprite file. The office adds it to each art URL
// (?v=rev), so an art update can never be served from a stale cache.
{
  const files = [manifest.background?.file, ...Object.values(manifest.sprites).map((s) => s.file), ...Object.values(manifest.characters).map((c) => c.file), ...Object.values(manifest.icons).map((i) => i.file), ...Object.values(manifest.ceo || {}).flatMap((c) => [c.file, c.portrait])].filter(Boolean).sort();
  const h = createHash("sha1");
  for (const f of files) h.update(f).update(readFileSync(join(OUT, f)));
  manifest.rev = h.digest("hex").slice(0, 10);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("manifest.json written");
