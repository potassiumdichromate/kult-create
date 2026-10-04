// The isometric pixel-art office. Everything is drawn procedurally on a small
// canvas (640x320) that CSS scales up with crisp pixels. Employees sit at
// desks, type while their pipeline step runs, pop a check mark when it is
// done, and the CEO walks the floor checking in on whoever just started.

export const W = 640, H = 320;
const OX = 304, OY = 80;           // screen position of grid corner (0,0)
const ROOM_X = 14, ROOM_Y = 12;    // floor size in tiles
const WALL = 70;                   // wall height in pixels

export const iso = (gx, gy, z = 0) => [OX + (gx - gy) * 16, OY + (gx + gy) * 8 - z];

// ------------------------------------------------------------------ layout
// Desk centre (x, y); the employee sits behind it at y - 0.95, facing us.
const DESKS = {
  producer: [2.2, 4], designer: [4.6, 4],
  artdirector: [7.4, 4], illustrator: [9.8, 4], background: [12.2, 4],
  engineer: [2.2, 8], qa: [4.6, 8], playtester: [7.0, 8],
  marketing: [9.8, 8], publisher: [12.2, 8]
};
const DEPARTMENTS = [
  { label: "PLANNING", x: 3.4, y: 4, color: "#ff7eb6" },
  { label: "ART", x: 9.8, y: 4, color: "#c792ea" },
  { label: "ENGINEERING", x: 4.6, y: 8, color: "#4dd4ac" },
  { label: "LAUNCH", x: 11, y: 8, color: "#ffd166" }
];
const AISLES = [1.7, 5.75, 9.8];   // walkable rows: behind row A, between rows, front
const CORRIDOR_X = 13.55;          // walkable column on the right
const CEO_HOME = [7, 1.7];
const SCREEN = { x0: 4.4, x1: 9.6, z0: 16, z1: 58 };

const SKINS = ["#f5d0a9", "#e0ac69", "#c68642", "#8d5524", "#ffdbac", "#f1c27d"];
const HAIRS = ["#2b1b17", "#5a3825", "#d6b370", "#a52a2a", "#1c1c3c", "#e8e8e8", "#6b4f9e"];

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};
const hash = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

export class Office {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    canvas.width = W; canvas.height = H;
    this.ctx.imageSmoothingEnabled = false;
    this.t = 0;
    this.people = new Map();
    this.particles = [];
    this.notes = [];                 // sticky notes on the whiteboard (finished steps)
    this.screen = { mode: "idle", title: "", progress: 0, image: null, lines: [] };
    this.portrait = null;
    this.lightsOn = true;
    this.screenCanvas = document.createElement("canvas");
    this.screenCanvas.width = 156; this.screenCanvas.height = 66;
    this.static = null;
  }

  // ---------------------------------------------------------------- staff
  setStaff(employees, ceo) {
    this.people.clear();
    for (const e of employees) {
      const h = hash(e.id + (e.name || ""));
      const isCeo = e.id === "ceo";
      const desk = DESKS[e.id];
      const pos = isCeo ? [...CEO_HOME] : [desk[0], desk[1] - 0.95];
      this.people.set(e.id, {
        ...e,
        name: isCeo ? ceo?.name || "CEO" : e.name,
        isCeo, desk,
        x: pos[0], y: pos[1], path: [], walking: false, facing: 1,
        skin: SKINS[h % SKINS.length], hair: HAIRS[(h >> 3) % HAIRS.length], hairStyle: (h >> 6) % 5,
        state: "idle", stateAt: 0, blinkAt: 2 + (h % 50) / 10, phase: (h % 100) / 100 * Math.PI * 2
      });
    }
  }

  person(id) { return this.people.get(id); }

  setState(id, state) {
    const p = this.people.get(id);
    if (!p) return;
    p.state = state;
    p.stateAt = this.t;
  }

  resetStates() { for (const p of this.people.values()) { p.state = "idle"; } this.notes = []; }

  // CEO walks to stand in front of an employee's desk, then goes home.
  visit(id) {
    const ceo = this.people.get("ceo"), target = this.people.get(id);
    if (!ceo || !target || target.isCeo) return;
    if (ceo.path.length > 2) return; // already busy walking
    const stand = [target.desk[0], target.desk[1] + 0.95];
    this.walkTo(ceo, stand, () => setTimeout(() => this.walkTo(ceo, CEO_HOME), 1600));
  }

  walkTo(p, [tx, ty], done) {
    const aisleOf = (y) => AISLES.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
    const from = aisleOf(p.y), to = aisleOf(ty);
    const pts = [];
    if (Math.abs(p.y - from) > 0.05) pts.push([p.x, from]);
    if (from !== to) { pts.push([CORRIDOR_X, from], [CORRIDOR_X, to]); }
    pts.push([tx, to]);
    if (Math.abs(ty - to) > 0.05) pts.push([tx, ty]);
    p.path = pts;
    p.onArrive = done || null;
  }

  // ---------------------------------------------------------------- effects
  packet(fromId, color) {
    const p = this.people.get(fromId);
    if (!p) return;
    const [sx, sy] = iso(p.x, p.y, 34);
    const [tx, ty] = iso((SCREEN.x0 + SCREEN.x1) / 2, 0, (SCREEN.z0 + SCREEN.z1) / 2);
    this.particles.push({ kind: "packet", sx, sy, tx, ty, t0: this.t, dur: 0.9, color });
  }

  confetti() {
    const [cx, cy] = iso((SCREEN.x0 + SCREEN.x1) / 2, 0, SCREEN.z1);
    const colors = ["#ff7eb6", "#7ee081", "#ffd166", "#5ec8f2", "#c792ea", "#f78c6b"];
    for (let i = 0; i < 90; i += 1) {
      this.particles.push({ kind: "confetti", x: cx + (Math.random() - 0.5) * 80, y: cy - Math.random() * 10, vx: (Math.random() - 0.5) * 70, vy: -40 - Math.random() * 60, t0: this.t, dur: 2.6 + Math.random(), color: colors[i % colors.length] });
    }
  }

  addNote(color) { if (this.notes.length < 24) this.notes.push({ color, tilt: Math.random() < 0.5 ? 0 : 1 }); }

  // Screen-space anchor above a person's head, for DOM speech bubbles.
  anchor(id) {
    const p = this.people.get(id);
    if (!p) return null;
    const sitting = !p.isCeo && !p.walking;
    return iso(p.x, p.y, sitting ? 44 : 44);
  }

  hit(x, y) {
    let best = null;
    for (const p of this.people.values()) {
      const [sx, sy] = iso(p.x, p.y, 0);
      const top = sy - (p.isCeo ? 34 : 38);
      if (x >= sx - 8 && x <= sx + 8 && y >= top && y <= sy - (p.isCeo ? 0 : 12)) {
        if (!best || p.y > best.y) best = p;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- loop
  update(dt) {
    this.t += dt;
    for (const p of this.people.values()) {
      if (!p.path.length) { p.walking = false; continue; }
      p.walking = true;
      const [tx, ty] = p.path[0];
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy), step = 3.2 * dt;
      if (Math.abs(dx - dy) > 0.01) p.facing = dx - dy > 0 ? 1 : -1;
      if (d <= step) {
        p.x = tx; p.y = ty; p.path.shift();
        if (!p.path.length) { p.walking = false; const f = p.onArrive; p.onArrive = null; f?.(); }
      } else { p.x += (dx / d) * step; p.y += (dy / d) * step; }
    }
    this.particles = this.particles.filter((q) => this.t - q.t0 < q.dur);
  }

  draw() {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (!this.static) this.static = this.buildStatic();
    g.drawImage(this.static, 0, 0);
    this.drawWallDynamic(g);
    // Depth-sorted scene objects.
    const items = [];
    for (const [id, [x, y]] of Object.entries(DESKS)) {
      items.push({ k: x + y + 0.01, draw: () => this.drawChair(g, x, y - 1.25, id) });
      items.push({ k: x + y + 0.5, draw: () => this.drawDesk(g, x, y, id) });
    }
    for (const p of this.people.values()) items.push({ k: p.x + p.y + 0.02, draw: () => this.drawPerson(g, p) });
    items.push({ k: 6.4 + 1.2, draw: () => this.drawPodium(g) });
    items.push({ k: 0.7 + 11.3, draw: () => this.drawPlant(g, 0.7, 11.3) });
    items.push({ k: 13.4 + 11.2, draw: () => this.drawCoffee(g, 13.0, 10.8) });
    items.push({ k: 0.6 + 0.6, draw: () => this.drawCooler(g, 0.6, 0.6) });
    items.push({ k: 13.3 + 0.7, draw: () => this.drawPlant(g, 13.3, 0.7) });
    items.sort((a, b) => a.k - b.k);
    for (const it of items) it.draw();
    this.drawStatusIcons(g);
    this.drawParticles(g);
    if (!this.lightsOn) { g.fillStyle = "rgba(8,6,24,0.55)"; g.fillRect(0, 0, W, H); }
  }

  // ---------------------------------------------------------------- primitives
  poly(g, pts, fill) {
    g.beginPath();
    g.moveTo(Math.round(pts[0][0]), Math.round(pts[0][1]));
    for (const p of pts.slice(1)) g.lineTo(Math.round(p[0]), Math.round(p[1]));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  }

  box(g, x, y, w, d, h, color, z = 0) {
    const A = iso(x, y, z + h), B = iso(x + w, y, z + h), C = iso(x + w, y + d, z + h), D = iso(x, y + d, z + h);
    const B0 = iso(x + w, y, z), C0 = iso(x + w, y + d, z), D0 = iso(x, y + d, z);
    this.poly(g, [D, C, C0, D0], shade(color, 0.78));
    this.poly(g, [B, C, C0, B0], shade(color, 0.62));
    this.poly(g, [A, B, C, D], color);
  }

  // A flat quad on the back-right wall (gy = 0) from gx x0..x1, height z0..z1.
  wallQuadR(g, x0, x1, z0, z1, fill) { this.poly(g, [iso(x0, 0, z1), iso(x1, 0, z1), iso(x1, 0, z0), iso(x0, 0, z0)], fill); }
  wallQuadL(g, y0, y1, z0, z1, fill) { this.poly(g, [iso(0, y0, z1), iso(0, y1, z1), iso(0, y1, z0), iso(0, y0, z0)], fill); }

  // Draws an image/canvas onto the back-right wall plane.
  imageOnWallR(g, img, x0, x1, z0, z1) {
    const [sx, sy] = iso(x0, 0, z1);
    const wTiles = x1 - x0, hPx = z1 - z0;
    g.save();
    g.setTransform((16 * wTiles) / img.width, (8 * wTiles) / img.width, 0, hPx / img.height, sx, sy);
    g.drawImage(img, 0, 0);
    g.restore();
  }
  imageOnWallL(g, img, y0, y1, z0, z1) {
    const [sx, sy] = iso(0, y0, z1);
    const wTiles = y1 - y0, hPx = z1 - z0;
    g.save();
    g.setTransform((-16 * wTiles) / img.width, (8 * wTiles) / img.width, 0, hPx / img.height, sx, sy);
    g.drawImage(img, 0, 0);
    g.restore();
  }

  // ---------------------------------------------------------------- static layer
  buildStatic() {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    // Backdrop
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1a1033"); bg.addColorStop(1, "#0b0717");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // Floor: warm wood planks with department rugs.
    for (let gx = 0; gx < ROOM_X; gx += 1) {
      for (let gy = 0; gy < ROOM_Y; gy += 1) {
        const [x, y] = iso(gx, gy);
        const base = (gx + gy) % 2 ? "#6b4a3a" : "#74513f";
        this.diamond(g, x, y, base);
        g.fillStyle = "rgba(0,0,0,0.12)";
        g.fillRect(x - 1, y + 7, 2, 1);
      }
    }
    const rug = (x0, y0, x1, y1, color) => this.poly(g, [iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)], color);
    rug(4.6, 0.6, 9.4, 2.7, "#3b2a6b");
    rug(4.9, 0.85, 9.1, 2.45, "#4b3a8b");
    for (const d of DEPARTMENTS) rug(d.x - 2.4, d.y - 1.7, d.x + 2.4, d.y + 0.85, shade(d.color, 0.32));
    // Walls
    const wallL = "#2e2457", wallR = "#3a2f6e";
    this.poly(g, [iso(0, 0, WALL), iso(0, ROOM_Y, WALL), iso(0, ROOM_Y, 0), iso(0, 0, 0)], wallL);
    this.poly(g, [iso(0, 0, WALL), iso(ROOM_X, 0, WALL), iso(ROOM_X, 0, 0), iso(0, 0, 0)], wallR);
    // Skirting and top trim
    this.poly(g, [iso(0, 0, 6), iso(0, ROOM_Y, 6), iso(0, ROOM_Y, 0), iso(0, 0, 0)], "#221a44");
    this.poly(g, [iso(0, 0, 6), iso(ROOM_X, 0, 6), iso(ROOM_X, 0, 0), iso(0, 0, 0)], "#2a2152");
    this.poly(g, [iso(0, 0, WALL + 4), iso(0, ROOM_Y, WALL + 4), iso(0, ROOM_Y, WALL), iso(0, 0, WALL)], "#4a3d86");
    this.poly(g, [iso(0, 0, WALL + 4), iso(ROOM_X, 0, WALL + 4), iso(ROOM_X, 0, WALL), iso(0, 0, WALL)], "#56489a");
    // Windows on the left wall: night city.
    for (const [y0, y1] of [[1.6, 3.8], [8.4, 10.6]]) {
      this.wallQuadL(g, y0 - 0.12, y1 + 0.12, 18, 60, "#171033");
      this.wallQuadL(g, y0, y1, 21, 57, "#22306b");
      const sky = document.createElement("canvas"); sky.width = 44; sky.height = 36;
      const s = sky.getContext("2d");
      const grad = s.createLinearGradient(0, 0, 0, 36); grad.addColorStop(0, "#1b2a6b"); grad.addColorStop(1, "#6b3f8f");
      s.fillStyle = grad; s.fillRect(0, 0, 44, 36);
      for (let i = 0; i < 9; i += 1) { s.fillStyle = "#fff"; s.fillRect((i * 17 + y0 * 11) % 44, (i * 7) % 14, 1, 1); }
      s.fillStyle = "#0f0b26";
      for (let i = 0; i < 8; i += 1) { const bh = 8 + ((i * 13 + y0 * 5) % 16); s.fillRect(i * 6, 36 - bh, 5, bh); }
      s.fillStyle = "#ffd166";
      for (let i = 0; i < 14; i += 1) s.fillRect((i * 7 + 2) % 44, 24 + ((i * 5) % 10), 1, 1);
      this.imageOnWallL(g, sky, y0, y1, 21, 57);
      this.wallQuadL(g, (y0 + y1) / 2 - 0.04, (y0 + y1) / 2 + 0.04, 21, 57, "#171033");
    }
    // Whiteboard frame on the left wall (notes are dynamic).
    this.wallQuadL(g, 4.8, 7.6, 20, 58, "#9aa0b8");
    this.wallQuadL(g, 4.9, 7.5, 22, 56, "#eef1f8");
    // Big screen bezel on the right wall.
    this.wallQuadR(g, SCREEN.x0 - 0.15, SCREEN.x1 + 0.15, SCREEN.z0 - 4, SCREEN.z1 + 4, "#0d0a1c");
    // Portrait frame (CEO INFT) and neon sign plate.
    this.wallQuadR(g, 1.3, 3.1, 24, 58, "#c9a227");
    this.wallQuadR(g, 10.6, 13.4, 34, 58, "#120d26");
    return c;
  }

  diamond(g, x, y, color) {
    g.fillStyle = color;
    for (let r = 0; r < 16; r += 1) {
      const hw = r < 8 ? (r + 1) * 2 : (16 - r) * 2;
      g.fillRect(x - hw, y + r, hw * 2, 1);
    }
  }

  drawWallDynamic(g) {
    // Whiteboard: one sticky note per finished step.
    this.notes.forEach((n, i) => {
      const col = i % 6, row = Math.floor(i / 6);
      const y0 = 5.05 + col * 0.4, z1 = 52 - row * 8;
      this.wallQuadL(g, y0, y0 + 0.3, z1 - 6, z1, n.color);
    });
    // CEO portrait.
    if (this.portrait?.complete && this.portrait.naturalWidth) {
      this.imageOnWallR(g, this.portrait, 1.42, 2.98, 27, 55);
    } else {
      this.wallQuadR(g, 1.42, 2.98, 27, 55, "#2b2050");
      const [x, y] = iso(2.2, 0, 46);
      g.fillStyle = "#f2c14e"; g.fillRect(x - 3, y - 2, 6, 6); g.fillRect(x - 5, y + 6, 10, 6);
    }
    // Neon sign
    const flicker = Math.sin(this.t * 13) > -0.97 ? 1 : 0.4;
    this.neon(g, flicker);
    // Big screen
    this.paintScreen();
    this.imageOnWallR(g, this.screenCanvas, SCREEN.x0, SCREEN.x1, SCREEN.z0, SCREEN.z1);
    // Clock
    const [cx, cy] = iso(3.7, 0, 50);
    g.fillStyle = "#e8e8f0"; g.fillRect(cx - 4, cy - 4, 8, 8);
    g.fillStyle = "#1a1033"; g.fillRect(cx, cy - 3, 1, 3); g.fillRect(cx, cy, 2 + Math.floor(this.t % 2), 1);
  }

  neon(g, a) {
    const c = document.createElement("canvas"); c.width = 84; c.height = 24;
    const s = c.getContext("2d");
    s.font = "8px 'Press Start 2P', monospace"; s.textBaseline = "top";
    s.fillStyle = `rgba(255,126,182,${a})`; s.fillText("KULT", 4, 3);
    s.fillStyle = `rgba(94,200,242,${a})`; s.fillText("CREATE", 4, 13);
    this.imageOnWallR(g, c, 10.75, 13.25, 36, 56);
  }

  paintScreen() {
    const c = this.screenCanvas, s = c.getContext("2d"), S = this.screen;
    s.imageSmoothingEnabled = false;
    s.fillStyle = "#0a1630"; s.fillRect(0, 0, c.width, c.height);
    s.font = "8px 'Press Start 2P', monospace"; s.textBaseline = "top";
    if (S.mode === "idle") {
      s.fillStyle = "#5ec8f2"; s.fillText("KULT CREATE", 34, 14);
      s.fillStyle = "#8f86c8"; s.font = "6px 'Press Start 2P', monospace";
      s.fillText(Math.floor(this.t * 1.5) % 2 ? "AWAITING BRIEF_" : "AWAITING BRIEF", 34, 34);
      s.fillText(S.title ? S.title.slice(0, 22).toUpperCase() : "", 6, 52);
      return;
    }
    if (S.image?.complete && S.image.naturalWidth) {
      const ih = S.mode === "done" ? 58 : 44;
      const iw = Math.round((S.image.naturalWidth / S.image.naturalHeight) * ih);
      s.drawImage(S.image, S.mode === "done" ? 4 : c.width - iw - 4, 4, Math.min(iw, 70), ih);
    }
    s.font = "6px 'Press Start 2P', monospace";
    if (S.mode === "work") {
      s.fillStyle = "#ffd166"; s.fillText("IN PRODUCTION", 5, 5);
      s.fillStyle = "#e8e8f0";
      (S.lines || []).slice(-4).forEach((l, i) => s.fillText(l.slice(0, 13).toUpperCase(), 5, 17 + i * 9));
      s.fillStyle = "#1e2c55"; s.fillRect(5, 56, 146, 5);
      s.fillStyle = "#7ee081"; s.fillRect(5, 56, Math.round(146 * Math.min(1, S.progress)), 5);
    } else if (S.mode === "done") {
      s.fillStyle = "#7ee081"; s.fillText("SHIPPED!", 82, 10);
      s.fillStyle = "#e8e8f0";
      const words = (S.title || "").toUpperCase().split(/\s+/);
      let line = "", y = 26;
      for (const w of words) { if ((line + w).length > 11) { s.fillText(line, 82, y); y += 9; line = ""; } line += `${w} `; }
      s.fillText(line, 82, y);
    } else if (S.mode === "failed") {
      s.fillStyle = "#f78c6b"; s.fillText("BUILD FAILED", 30, 18);
      s.fillStyle = "#e8e8f0"; s.fillText("CREDITS REFUNDED", 22, 34);
    }
    // scanlines
    s.fillStyle = "rgba(0,0,0,0.18)";
    for (let y = 0; y < c.height; y += 2) s.fillRect(0, y, c.width, 1);
  }

  // ---------------------------------------------------------------- furniture
  drawDesk(g, x, y, id) {
    const p = this.people.get(id);
    const top = "#c8a27a";
    this.box(g, x - 1, y - 0.45, 2, 0.9, 14, top);
    // drawer + legs shading
    const [lx, ly] = iso(x - 0.95, y + 0.45, 3);
    g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(lx, ly - 9, 2, 9);
    // Monitor (back facing us) and its glow when working.
    const working = p?.state === "working";
    this.box(g, x + 0.2, y - 0.42, 0.7, 0.1, 11, "#2a2a3a", 14);
    this.box(g, x + 0.5, y - 0.32, 0.1, 0.1, 2, "#2a2a3a", 14);
    if (working) {
      const [mx, my] = iso(x + 0.55, y - 0.42, 27);
      g.fillStyle = `rgba(126,224,255,${0.25 + 0.12 * Math.sin(this.t * 6)})`;
      g.fillRect(mx - 11, my - 3, 22, 3);
    }
    // Props per role.
    const [px, py] = iso(x - 0.55, y + 0.1, 14);
    if (id === "illustrator" || id === "artdirector" || id === "background") {
      g.fillStyle = "#1c1c2c"; g.fillRect(px - 5, py - 2, 9, 4); g.fillStyle = "#7ee081"; g.fillRect(px - 4, py - 1, 1, 1);
    } else if (id === "engineer" || id === "qa") {
      g.fillStyle = "#e8e8f0"; g.fillRect(px - 3, py - 4, 5, 5); g.fillStyle = "#7a4a2a"; g.fillRect(px - 2, py - 3, 3, 1);
    } else if (id === "playtester") {
      g.fillStyle = "#333"; g.fillRect(px - 4, py - 2, 9, 4); g.fillStyle = "#ff7eb6"; g.fillRect(px - 3, py - 1, 1, 1); g.fillStyle = "#5ec8f2"; g.fillRect(px + 2, py - 1, 1, 1);
    } else {
      g.fillStyle = "#fffbe6"; g.fillRect(px - 4, py - 2, 7, 4); g.fillStyle = "#ccc"; g.fillRect(px - 3, py - 1, 5, 1);
    }
  }

  drawChair(g, x, y) {
    this.box(g, x - 0.28, y + 0.1, 0.56, 0.5, 9, "#3d3560");
    this.box(g, x - 0.3, y, 0.6, 0.1, 19, "#4b4275");
  }

  drawPodium(g) {
    this.box(g, 5.7, 1.0, 0.9, 0.5, 18, "#3d3560");
    const [x, y] = iso(6.15, 1.25, 18);
    g.fillStyle = "#f2c14e"; g.fillRect(x - 3, y - 2, 6, 1);
  }

  drawPlant(g, x, y) {
    this.box(g, x - 0.22, y - 0.22, 0.44, 0.44, 8, "#b5654a");
    const [px, py] = iso(x, y, 8);
    const sway = Math.round(Math.sin(this.t * 1.3 + x) * 1);
    g.fillStyle = "#2f8f5b";
    g.fillRect(px - 5 + sway, py - 14, 10, 10); g.fillRect(px - 7 + sway, py - 10, 14, 5);
    g.fillStyle = "#47b877"; g.fillRect(px - 3 + sway, py - 16, 5, 6); g.fillRect(px + 2 + sway, py - 12, 4, 4);
  }

  drawCooler(g, x, y) {
    this.box(g, x - 0.25, y - 0.25, 0.5, 0.5, 18, "#d8dce8");
    const [px, py] = iso(x, y, 18);
    g.fillStyle = "#7fc8f8"; g.fillRect(px - 4, py - 11, 8, 10);
    g.fillStyle = "#b8e4ff"; g.fillRect(px - 3, py - 10, 2, 7);
  }

  drawCoffee(g, x, y) {
    this.box(g, x - 0.5, y - 0.4, 1.1, 0.8, 16, "#5b4a8a");
    const [px, py] = iso(x, y, 16);
    g.fillStyle = "#222"; g.fillRect(px - 4, py - 12, 8, 11);
    g.fillStyle = "#f78c6b"; g.fillRect(px - 2, py - 10, 1, 1);
    if (Math.sin(this.t * 2) > 0) { g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(px + 1, py - 16 - Math.floor((this.t * 6) % 4), 1, 2); }
  }

  // ---------------------------------------------------------------- people
  drawPerson(g, p) {
    const sitting = !p.isCeo && !p.walking && Math.hypot(p.x - p.desk[0], p.y - (p.desk[1] - 0.95)) < 0.05;
    const [sx0, sy0] = iso(p.x, p.y, sitting ? 13 : 0);
    const sx = Math.round(sx0), sy = Math.round(sy0);
    const t = this.t;
    const working = p.state === "working";
    const bob = p.walking ? (Math.floor(t * 8) % 2) : working ? (Math.floor(t * 5 + p.phase) % 2 ? 0 : 1) * 0 : Math.round(Math.sin(t * 1.6 + p.phase) * 0.6);
    const shirt = p.color, shirtD = shade(p.color, 0.7);
    // shadow
    if (!sitting) { g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(sx - 6, sy - 1, 12, 3); }
    let y = sy - bob;
    // legs
    if (!sitting) {
      const step = p.walking ? Math.floor(t * 8) % 2 : 0;
      g.fillStyle = "#2b2b45";
      g.fillRect(sx - 4, y - 8 + (step ? 1 : 0), 3, 8 - (step ? 1 : 0));
      g.fillRect(sx + 1, y - 8 + (step ? 0 : 1), 3, 8 - (step ? 0 : 1));
      g.fillStyle = "#15151f"; g.fillRect(sx - 4, y - 1, 3, 1); g.fillRect(sx + 1, y - 1, 3, 1);
      y -= 8;
    }
    // torso
    g.fillStyle = shirt; g.fillRect(sx - 5, y - 10, 10, 10);
    g.fillStyle = shirtD; g.fillRect(sx + 3, y - 10, 2, 10);
    if (p.isCeo) { g.fillStyle = "#e8e8f0"; g.fillRect(sx - 1, y - 10, 2, 3); g.fillStyle = "#d1344b"; g.fillRect(sx - 1, y - 8, 2, 6); }
    // arms
    g.fillStyle = shirtD;
    if (working && sitting) {
      const a = Math.floor(t * 10 + p.phase) % 2;
      g.fillRect(sx - 7, y - 9, 2, 6 + a); g.fillRect(sx + 5, y - 9, 2, 7 - a);
      g.fillStyle = p.skin; g.fillRect(sx - 7, y - 3 + a, 2, 2); g.fillRect(sx + 5, y - 2 - a, 2, 2);
    } else if (p.state === "done" && t - p.stateAt < 1.2) {
      g.fillRect(sx - 7, y - 16, 2, 7); g.fillRect(sx + 5, y - 16, 2, 7); // arms up
      g.fillStyle = p.skin; g.fillRect(sx - 7, y - 18, 2, 2); g.fillRect(sx + 5, y - 18, 2, 2);
    } else {
      const swing = p.walking ? (Math.floor(t * 8) % 2 ? 1 : -1) : 0;
      g.fillRect(sx - 7, y - 9 + swing, 2, 7); g.fillRect(sx + 5, y - 9 - swing, 2, 7);
      g.fillStyle = p.skin; g.fillRect(sx - 7, y - 2 + swing, 2, 2); g.fillRect(sx + 5, y - 2 - swing, 2, 2);
    }
    // head
    const hy = y - 18;
    g.fillStyle = p.skin; g.fillRect(sx - 4, hy, 8, 8);
    g.fillStyle = shade(p.skin.startsWith("#") ? p.skin : "#e0ac69", 0.85); g.fillRect(sx + 2, hy + 1, 2, 7);
    // face (facing viewer unless walking away up the screen)
    const awayFromViewer = p.walking && p.path[0] && (p.path[0][0] + p.path[0][1]) < (p.x + p.y) - 0.01;
    const blink = (t + p.phase) % 4.2 < 0.12;
    if (!awayFromViewer) {
      g.fillStyle = "#1a1033";
      if (!blink) { g.fillRect(sx - 2, hy + 3, 1, 2); g.fillRect(sx + 1, hy + 3, 1, 2); }
      else { g.fillRect(sx - 2, hy + 4, 1, 1); g.fillRect(sx + 1, hy + 4, 1, 1); }
      if (p.state === "error") { g.fillRect(sx - 1, hy + 6, 2, 1); }
      else if (p.state === "done") { g.fillStyle = "#b5444b"; g.fillRect(sx - 1, hy + 6, 3, 1); }
    }
    if (working) { g.fillStyle = "rgba(126,224,255,0.22)"; g.fillRect(sx - 4, hy + 2, 8, 6); }
    // hair
    g.fillStyle = p.hair;
    const hs = p.hairStyle;
    g.fillRect(sx - 4, hy - 2, 8, 3);
    if (awayFromViewer) g.fillRect(sx - 4, hy, 8, 7);
    if (hs === 1) { g.fillRect(sx - 5, hy - 1, 2, 9); g.fillRect(sx + 3, hy - 1, 2, 9); }
    if (hs === 2) g.fillRect(sx - 2, hy - 5, 4, 3);
    if (hs === 3) { g.fillRect(sx - 4, hy - 4, 2, 2); g.fillRect(sx, hy - 4, 2, 2); g.fillRect(sx + 3, hy - 3, 1, 1); }
    if (hs === 4) { g.fillStyle = shade(p.color, 0.9); g.fillRect(sx - 5, hy - 3, 10, 3); g.fillRect(sx - 1 + 4 * p.facing, hy, 4, 1); }
    if (p.isCeo) { // crown
      g.fillStyle = "#f2c14e";
      g.fillRect(sx - 4, hy - 5, 8, 2); g.fillRect(sx - 4, hy - 7, 2, 2); g.fillRect(sx - 1, hy - 8, 2, 3); g.fillRect(sx + 2, hy - 7, 2, 2);
      g.fillStyle = "#d1344b"; g.fillRect(sx - 1, hy - 5, 2, 1);
    }
  }

  drawStatusIcons(g) {
    for (const p of this.people.values()) {
      const [ax, ay] = this.anchor(p.id).map(Math.round);
      const t = this.t, age = t - p.stateAt;
      if (p.state === "working") {
        for (let i = 0; i < 3; i += 1) {
          const on = Math.floor(t * 4) % 4 > i;
          g.fillStyle = on ? "#ffffff" : "rgba(255,255,255,0.3)";
          g.fillRect(ax - 5 + i * 4, ay - 4, 2, 2);
        }
      } else if (p.state === "done" && age < 5) {
        const lift = Math.min(6, age * 12);
        g.fillStyle = "#1f6b3c"; g.fillRect(ax - 5, ay - 9 - lift, 11, 9);
        g.fillStyle = "#7ee081";
        g.fillRect(ax - 3, ay - 5 - lift, 2, 2); g.fillRect(ax - 1, ay - 3 - lift, 2, 2); g.fillRect(ax + 1, ay - 5 - lift, 2, 2); g.fillRect(ax + 3, ay - 7 - lift, 2, 2);
      } else if (p.state === "error") {
        g.fillStyle = "#d1344b"; g.fillRect(ax - 3, ay - 12, 7, 11);
        g.fillStyle = "#fff"; g.fillRect(ax - 1, ay - 10, 2, 5); g.fillRect(ax - 1, ay - 4, 2, 2);
      } else if (p.state === "waiting") {
        g.fillStyle = "#ffd166"; g.fillRect(ax - 2, ay - 11, 5, 2); g.fillRect(ax + 2, ay - 9, 2, 3); g.fillRect(ax, ay - 6, 2, 2); g.fillRect(ax, ay - 3, 2, 2);
      }
    }
  }

  drawParticles(g) {
    for (const q of this.particles) {
      const k = (this.t - q.t0) / q.dur;
      if (q.kind === "packet") {
        const x = q.sx + (q.tx - q.sx) * k, y = q.sy + (q.ty - q.sy) * k - Math.sin(k * Math.PI) * 40;
        g.fillStyle = q.color; g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
        g.fillStyle = "rgba(255,255,255,0.7)"; g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 1, 1);
      } else {
        const tt = this.t - q.t0;
        const x = q.x + q.vx * tt, y = q.y + q.vy * tt + 60 * tt * tt;
        g.fillStyle = q.color; g.fillRect(Math.round(x), Math.round(y), 2, Math.floor(tt * 10) % 2 ? 2 : 1);
      }
    }
  }
}
