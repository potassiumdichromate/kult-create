// The Kult Create office: a glowing 3D isometric studio floor (see
// office3d.js for the scene). Employees sit at desks grouped by department,
// type while their pipeline step runs, pop a check mark when it is done, and
// the CEO (the player's own agent model) walks the floor checking in on
// whoever just started. The big screen shows the production live.
import * as THREE from "three";
import { OfficeScene, M, FONT, box, canvasTex, lightPool, V } from "./office3d.js";

// Desk centre (x, y); the employee sits behind it, facing the room.
const DESKS = {
  producer: [2.2, 4.8], designer: [4.6, 4.8],
  artdirector: [7.4, 4.8], illustrator: [9.8, 4.8], background: [12.2, 4.8],
  engineer: [2.2, 8.8], qa: [4.6, 8.8], playtester: [7.0, 8.8],
  marketing: [9.8, 8.8], publisher: [12.2, 8.8]
};
const DEPARTMENTS = [
  { label: "PLANNING", ids: ["producer", "designer"], color: "#ff7eb6" },
  { label: "ART", ids: ["artdirector", "illustrator", "background"], color: "#c792ea" },
  { label: "ENGINEERING", ids: ["engineer", "qa"], color: "#4dd4ac" },
  { label: "LAUNCH", ids: ["playtester", "marketing", "publisher"], color: "#ffd166" }
];
const LAYOUT = { aisles: [1.7, 6.6, 10.4], corridorX: 13.55, ceoHome: [6.75, 1.95] };
const seatOf = ([x, y]) => [x - 0.75, y - 0.8];

const THEME = {
  bg: "#0b0717", slab: "#1a1238", edge: "#ff4fa3", accents: ["#ff4fa3", "#4fd8ff"],
  floor: ["#6b4a3a", "#74513f", "#7a5644", "#664535"],
  wall: "#3a2f78", wallDark: "#1c1640", wallTop: "#6d5bd0", trim: "#a98bff",
  sky: ["#1b2a6b", "#6b3f8f"], cityLights: ["#ffd166", "#ffe9a8", "#4fd8ff", "#ff7eb6"],
  screenLight: "#4fd8ff", neon: [["KULT", "#ff4fa3"], ["CREATE", "#3fe3ff"]],
  rug: "#3b2a6b", rugInner: "#5a46a8", rugEdge: "#a98bff",
  desk: "#e9e5f5", deskPanel: "#3d3560", chair: "#4b4275", counter: "#5b4a8a",
  key: "#ffc9a8", fill: ["#a596ff", "#2a1650"], rim: "#4fd8ff",
  confetti: ["#ff7eb6", "#7ee081", "#ffd166", "#5ec8f2", "#c792ea", "#f78c6b"],
  models: "models/"
};

export class Office extends OfficeScene {
  constructor(canvas) {
    super(canvas, THEME, LAYOUT);
    this.deskViews = [];
    for (const [id, d] of Object.entries(DESKS)) {
      const dept = DEPARTMENTS.find((x) => x.ids.includes(id));
      const view = this.addDesk(d[0], d[1], { ledColor: dept.color, seat: seatOf(d) });
      this.deskProp(id, view);
      this.deskViews.push({ screen: view.screen, person: () => this.people.get(id) });
    }
    for (const dept of DEPARTMENTS) this.addDepartment(dept);
    this.addPodium(5.5, 1.3);
    this.addPlant(0.7, 11.3); this.addPlant(13.3, 0.7);
    this.addCooler(0.6, 0.6);
    this.addCoffee(13.0, 10.8);
    this.addArcade(0.55, 4.2);
  }

  // ---------------------------------------------------------------- staff
  setStaff(employees, ceo) {
    for (const p of this.people.values()) this.unembody(p);
    this.people.clear();
    // The CEO is the player's agent: its model comes from its AI Arena archetype.
    this.ceoArchetype = String(ceo?.archetype || "hybrid").toLowerCase();
    for (const e of employees) {
      const isCeo = e.id === "ceo", desk = DESKS[e.id];
      const seat = desk && seatOf(desk), pos = isCeo ? [...LAYOUT.ceoHome] : seat;
      const p = {
        ...e, name: isCeo ? ceo?.name || "CEO" : e.name, isCeo, desk, seat, look: e.id,
        x: pos[0], y: pos[1], path: [], walking: false, facing: 1,
        state: "idle", stateAt: 0, phase: ((e.id.length * 37 + e.id.charCodeAt(0)) % 100) / 100 * Math.PI * 2
      };
      this.people.set(e.id, p);
      this.embody(p);
    }
  }
  person(id) { return this.people.get(id); }
  setState(id, state) { const p = this.people.get(id); if (p) { p.state = state; p.stateAt = this.t; } }
  resetStates() { for (const p of this.people.values()) p.state = "idle"; this.clearNotes(); }

  // The CEO walks to stand in front of an employee's desk, then goes home.
  visit(id) {
    const ceo = this.people.get("ceo"), target = this.people.get(id);
    if (!ceo || !target || target.isCeo) return;
    if (ceo.path.length > 2) return; // already busy walking
    ceo.lookAt = null;
    this.walkTo(ceo, [target.desk[0] - 0.4, target.desk[1] + 1.0], () => {
      ceo.lookAt = [target.seat[0], target.seat[1]];
      setTimeout(() => { ceo.lookAt = null; this.walkTo(ceo, LAYOUT.ceoHome); }, 1600);
    });
  }

  // Portrait of an employee (for the dashboard's team grid); the CEO's is its model.
  portraitOf(id) {
    if (id === "ceo" && this.ceoPortrait) { const c = document.createElement("canvas"); c.width = c.height = this.ceoPortrait.width; c.getContext("2d").drawImage(this.ceoPortrait, 0, 0); return c; }
    const p = this.people.get(id);
    return super.portraitOf(id, p?.color);
  }

  // ---------------------------------------------------------------- props
  // Each department's floor zone glows in its colour, with its name on the floor.
  addDepartment({ label, ids, color }) {
    const xs = ids.map((id) => DESKS[id][0]), y = DESKS[ids[0]][1];
    const x0 = Math.min(...xs) - 1.25, x1 = Math.max(...xs) + 1.25, y0 = y - 1.55, y1 = y + 0.75;
    const tex = canvasTex(1024, Math.round(1024 * (y1 - y0) / (x1 - x0)), (g, W, H) => {
      const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, `${color}00`); grad.addColorStop(1, `${color}30`);
      g.fillStyle = grad; g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 28); g.fill();
      g.strokeStyle = `${color}aa`; g.lineWidth = 5; g.setLineDash([26, 16]); g.stroke(); g.setLineDash([]);
      g.font = `700 ${Math.round(H * 0.11)}px ${FONT}`; g.textBaseline = "bottom"; g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 18;
      g.fillText(label.split("").join(" "), 34, H - 20);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.2, 1.2, 1.2) }));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.012, (y0 + y1) / 2); m.renderOrder = 1;
    this.scene.add(m);
  }

  // A prop on the desk for the role.
  deskProp(id, view) {
    const g = new THREE.Group(), at = view.propAt(0.45, 0.05); g.position.copy(at); this.scene.add(g);
    if (id === "illustrator" || id === "artdirector" || id === "background") {
      const tab = box(0.5, 0.025, 0.36, M.std("#1c1c2c", { roughness: 0.3 }), 0, 0.012, 0); tab.rotation.x = -0.15; g.add(tab);
      const art = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28), new THREE.MeshBasicMaterial({ map: sketchTexture(id), color: new THREE.Color(1.3, 1.3, 1.3) }));
      art.rotation.x = -Math.PI / 2 - 0.15; art.position.y = 0.03; g.add(art);
      const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.22, 6), M.glow("#7ee081", 2)); pen.rotation.z = Math.PI / 2.4; pen.position.set(0.3, 0.03, 0.1); g.add(pen);
    } else if (id === "playtester") {
      g.add(box(0.24, 0.05, 0.13, M.std("#26243a", { roughness: 0.4 }), 0, 0.03, 0));
      for (const [x, c] of [[-0.06, "#ff4fa3"], [0.06, "#4fd8ff"]]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), M.glow(c, 3)); b.position.set(x, 0.06, 0.01); g.add(b); }
    } else if (id === "engineer" || id === "qa") {
      const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.12, 14), M.std("#e8e8f0")); mug.position.set(0.15, 0.06, 0); g.add(mug);
      const second = box(0.42, 0.28, 0.03, M.std("#1a1828"), -0.15, 0.2, 0.12); second.rotation.y = 0.35; g.add(second);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.24), M.glow(id === "qa" ? "#f78c6b" : "#4dd4ac", 0.8)); scr.rotation.y = Math.PI + 0.35; scr.position.set(-0.155, 0.2, 0.1); g.add(scr);
    } else {
      for (let i = 0; i < 3; i++) { const sh = box(0.3, 0.012, 0.22, M.std(i ? "#fffbe6" : "#f2f0ff"), 0.02 * i, 0.008 + i * 0.012, 0); sh.rotation.y = (i - 1) * 0.12; g.add(sh); }
      const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.12, 14), M.std(DEPARTMENTS.find((d) => d.ids.includes(id)).color)); mug.position.set(0.28, 0.06, -0.05); g.add(mug);
    }
  }

  // An arcade cabinet by the window, playing a little demo.
  addArcade(x, y) {
    const g = new THREE.Group(); g.position.set(x, 0, y); g.rotation.y = Math.PI / 2; this.scene.add(g);
    const body = M.std("#231a4a", { roughness: 0.4, metalness: 0.3 });
    g.add(box(0.72, 1.7, 0.6, body, 0, 0.85, 0));
    for (const s of [-1, 1]) g.add(box(0.03, 1.7, 0.62, M.glow(s < 0 ? "#ff4fa3" : "#4fd8ff", 2.6), s * 0.37, 0.85, 0));
    g.add(box(0.7, 0.24, 0.2, body, 0, 1.0, 0.35));
    const marquee = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.2), new THREE.MeshBasicMaterial({ map: canvasTex(256, 80, (c) => { c.fillStyle = "#14082e"; c.fillRect(0, 0, 256, 80); c.font = `700 44px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle"; c.shadowColor = "#ffd166"; c.shadowBlur = 14; c.fillStyle = "#ffd166"; c.fillText("PLAY", 128, 42); }), color: new THREE.Color(1.6, 1.6, 1.6) }));
    marquee.position.set(0, 1.58, 0.305); g.add(marquee);
    const screen = document.createElement("canvas"); screen.width = 160; screen.height = 128;
    const tex = new THREE.CanvasTexture(screen); tex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.44), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.4, 1.4, 1.4) }));
    scr.position.set(0, 1.27, 0.305); scr.rotation.x = -0.12; g.add(scr);
    for (const [bx, c] of [[-0.15, "#ff4fa3"], [0.0, "#4fd8ff"], [0.15, "#ffd166"]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), M.glow(c, 2.6)); b.position.set(bx, 1.13, 0.4); g.add(b); }
    const pool = lightPool("#ff4fa3", 1.2, 0.35); pool.position.set(0, 0.02, 0.7); g.add(pool);
    let last = 0;
    this.anims.push((t) => {
      if (t - last < 0.06) return; last = t;
      const c = screen.getContext("2d"), px = 80 + Math.sin(t * 1.7) * 50;
      c.fillStyle = "#06021a"; c.fillRect(0, 0, 160, 128);
      for (let i = 0; i < 20; i++) { c.fillStyle = "#ffffff55"; c.fillRect((i * 37) % 160, (i * 53 + t * 60) % 128, 2, 2); }
      for (let i = 0; i < 3; i++) { const ex = (i * 53 + t * 40) % 180 - 10, ey = 20 + i * 18 + Math.sin(t * 3 + i) * 6; c.fillStyle = ["#ff4fa3", "#c792ea", "#7ee081"][i]; c.fillRect(ex, ey, 14, 10); }
      c.fillStyle = "#ffd166"; for (let k = 0; k < 4; k++) c.fillRect(px - 1, 96 - ((t * 140 + k * 30) % 100), 2, 6);
      c.fillStyle = "#4fd8ff"; c.beginPath(); c.moveTo(px, 98); c.lineTo(px - 10, 114); c.lineTo(px + 10, 114); c.fill();
      tex.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- the big screen
  paintScreen() {
    // Logical 156x66, painted at 6x for sharp text.
    const c = this.screenCanvas, s = c.getContext("2d"), S = this.screen, CW = 156, CH = 66;
    s.setTransform(c.width / CW, 0, 0, c.height / CH, 0, 0);
    const bg = s.createLinearGradient(0, 0, 0, CH); bg.addColorStop(0, "#0d1840"); bg.addColorStop(1, "#160a33");
    s.fillStyle = bg; s.fillRect(0, 0, CW, CH);
    s.textBaseline = "top";
    const text = (str, x, y, color, size = 6, weight = 600) => { s.font = `${weight} ${size}px ${FONT}`; s.fillStyle = color; s.fillText(str, x, y); };
    if (S.mode === "idle") {
      text("KULT CREATE", 22, 11, "#5ec8f2", 15, 700);
      text(Math.floor(this.t * 1.5) % 2 ? "AWAITING BRIEF_" : "AWAITING BRIEF", 23, 32, "#a99cf0", 8);
      text(S.title ? S.title.slice(0, 26).toUpperCase() : "", 23, 49, "#ff7eb6", 7.5, 700);
    } else {
      if (S.image?.complete && S.image.naturalWidth) {
        const ih = S.mode === "done" ? 58 : 44;
        const iw = Math.round((S.image.naturalWidth / S.image.naturalHeight) * ih);
        s.drawImage(S.image, S.mode === "done" ? 4 : CW - Math.min(iw, 70) - 4, 4, Math.min(iw, 70), ih);
      }
      if (S.mode === "work") {
        text("IN PRODUCTION", 5, 4, "#ffd166", 7, 700);
        (S.lines || []).slice(-4).forEach((l, i) => text(l.slice(0, 18).toUpperCase(), 5, 16 + i * 9, "#e8e8f0", 6));
        s.fillStyle = "#1e2c55"; s.beginPath(); s.roundRect(5, 56, 146, 5, 2.5); s.fill();
        s.fillStyle = "#7ee081"; s.beginPath(); s.roundRect(5, 56, Math.max(5, Math.round(146 * Math.min(1, S.progress))), 5, 2.5); s.fill();
      } else if (S.mode === "done") {
        text("SHIPPED!", 82, 8, "#7ee081", 9, 700);
        const words = (S.title || "").toUpperCase().split(/\s+/);
        let line = "", y = 24;
        for (const w of words) { if ((line + w).length > 13) { text(line, 82, y, "#e8e8f0", 6.5); y += 9; line = ""; } line += `${w} `; }
        text(line, 82, y, "#e8e8f0", 6.5);
      } else if (S.mode === "failed") {
        text("BUILD FAILED", 36, 18, "#f78c6b", 9, 700);
        text("CREDITS REFUNDED", 38, 34, "#e8e8f0", 6.5);
      }
    }
    // Scanlines.
    s.fillStyle = "rgba(0,0,0,0.14)";
    for (let y = 0; y < CH; y += 1.5) s.fillRect(0, y, CW, 0.4);
  }
}

// A little painting in progress on each art desk's tablet.
function sketchTexture(id) {
  return canvasTex(256, 168, (g, W, H) => {
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, id === "background" ? "#1b2a6b" : "#2a1650"); sky.addColorStop(1, id === "background" ? "#ff7eb6" : "#5ec8f2");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    if (id === "background") { g.fillStyle = "#140c30"; for (let i = 0; i < 7; i++) { const h = 40 + ((i * 37) % 70); g.fillRect(i * 38, H - h, 30, h); } }
    else { g.fillStyle = "#ffd166"; g.beginPath(); g.arc(W / 2, H / 2, 40, 0, Math.PI * 2); g.fill(); g.fillStyle = "#140c30"; g.fillRect(W / 2 - 18, H / 2 - 10, 10, 12); g.fillRect(W / 2 + 8, H / 2 - 10, 10, 12); }
  });
}
