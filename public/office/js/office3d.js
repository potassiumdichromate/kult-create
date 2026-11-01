// The office in 3D: the studio floor as a glowing isometric diorama floating
// at neon dusk, in the Kult World look (three.js, bloom). Kult Create and Kult
// Sports each keep a copy of this file; keep them in sync. Their world.js
// subclasses OfficeScene with the floor plan, the wall screen and the props.
//
// Grid units are metres: the room is ROOM.X by ROOM.Y, gx runs along the
// back-right wall, gy along the back-left wall, and the camera looks in from
// the open front corner, like the pixel office did. People are plain objects
// ({ x, y, path, state, ... }) moved on the grid; each gets a 3D body here.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

export const ROOM = { X: 14, Y: 12, H: 3.4 };
export const FONT = '"Chakra Petch", "Inter", system-ui, sans-serif';
export const hash = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
export const V = (gx, gy, h = 0) => new THREE.Vector3(gx, h, gy);
const SEAT_H = 0.47, CEO_H = 1.6, WALK_SPEED = 2.6;

// ------------------------------------------------------------------ materials & textures
const mats = new Map();
const mat = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };
// Emission scale for neon trims: enough to read as lit, not enough to bloom
// over the furniture and the team.
const NEON = 0.45;
export const M = {
  std: (c, o = {}) => mat(`std${c}${JSON.stringify(o)}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05, ...o })),
  glow: (c, i = 2.2) => mat(`glow${c}${i}`, () => new THREE.MeshStandardMaterial({ color: "#000000", emissive: c, emissiveIntensity: i * NEON, roughness: 1 })),
  metal: (c = "#3a3560") => mat(`metal${c}`, () => new THREE.MeshStandardMaterial({ color: c, metalness: 0.65, roughness: 0.35 })),
  hidden: () => mat("hidden", () => new THREE.MeshBasicMaterial({ visible: false }))
};
export function canvasTex(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 8;
  return t;
}
export const glowTexture = (() => { let t; return () => t || (t = canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,0.45)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); })); })();
// A soft additive pool of light on the floor.
export function lightPool(color, radius = 2, opacity = 0.5) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), new THREE.MeshBasicMaterial({ map: glowTexture(), color, transparent: true, opacity: opacity * 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02; m.renderOrder = 1;
  return m;
}
export const box = (w, h, d, material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };
const round = (r, material) => new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), material);
const capsule = (r, len, material) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), material); m.castShadow = true; return m; };

// ------------------------------------------------------------------ people
// One look per staff member (the ten employees of Kult Create; Kult Sports
// dresses its analysts in them too). shirt is the role colour.
export const LOOKS = {
  producer: { shirt: "#ff7eb6", hair: "#3a2318", style: "bob", skin: "#f1c27d", glasses: true },
  designer: { shirt: "#7ee081", hair: "#4a2a1a", style: "long", skin: "#c68642" },
  artdirector: { shirt: "#c792ea", hair: "#e8e8f0", style: "bun", skin: "#ffdbac", glasses: true },
  illustrator: { shirt: "#ff9f5a", hair: "#a52a2a", style: "spiky", skin: "#f5d0a9" },
  background: { shirt: "#5ec8f2", hair: "#1c1c3c", style: "bun", skin: "#e0ac69" },
  marketing: { shirt: "#ffd166", hair: "#d6b370", style: "long", skin: "#f5d0a9" },
  engineer: { shirt: "#4dd4ac", hair: "#2b1b17", style: "short", skin: "#8d5524", glasses: true, headset: true },
  qa: { shirt: "#f78c6b", hair: "#5a3825", style: "cap", skin: "#e0ac69" },
  playtester: { shirt: "#9fa8ff", hair: "#6b4f9e", style: "spiky", skin: "#ffdbac", headset: true },
  publisher: { shirt: "#e8e8f0", hair: "#7a7a88", style: "short", skin: "#c68642", tie: "#d1344b" }
};
export const lookSpec = (look, color) => ({ ...(LOOKS[look] || LOOKS[Object.keys(LOOKS)[hash(look) % 10]]), ...(color ? { shirt: color } : {}) });

// A chibi office worker built from rounded shapes, with pivots for a little
// procedural animation (sit, type, walk, cheer). Faces +z.
export function buildPerson(spec, { crown = false } = {}) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = M.std(spec.skin, { roughness: 0.6 }), shirt = M.std(spec.shirt, { roughness: 0.55 }), pants = M.std("#2b2b45"), hair = M.std(spec.hair, { roughness: 0.5 });
  const legs = [-1, 1].map((s) => {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.09, 0.6, 0);
    const leg = capsule(0.075, 0.36, pants); leg.position.y = -0.27; pivot.add(leg);
    const shoe = box(0.13, 0.08, 0.2, M.std("#15151f"), 0, -0.56, 0.03); pivot.add(shoe);
    body.add(pivot); return pivot;
  });
  const torso = capsule(0.17, 0.2, shirt); torso.position.y = 0.86; torso.scale.set(1, 1, 0.8); body.add(torso);
  // A small neon badge on the chest, in the role colour, so bloom picks everyone out.
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), M.glow(spec.shirt, 3)); badge.position.set(0.07, 0.93, 0.14); body.add(badge);
  if (spec.tie) { const tie = box(0.05, 0.2, 0.02, M.std(spec.tie), 0, 0.88, 0.14); body.add(tie); }
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.21, 1.0, 0);
    const arm = capsule(0.055, 0.24, shirt); arm.position.y = -0.15; pivot.add(arm);
    const hand = round(0.06, skin); hand.position.y = -0.33; pivot.add(hand);
    body.add(pivot); return pivot;
  });
  const head = new THREE.Group(); head.position.y = 1.23; body.add(head);
  const skull = round(0.23, skin); skull.castShadow = true; head.add(skull);
  const eyeM = M.std("#1a1033", { roughness: 0.3 });
  const eyes = [-1, 1].map((s) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), eyeM); e.scale.set(1, 1.35, 0.6); e.position.set(s * 0.08, 0.0, 0.205); head.add(e); return e; });
  const blushM = M.std("#ff8fa3", { transparent: true, opacity: 0.55 });
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), blushM); b.position.set(s * 0.13, -0.06, 0.2); b.rotation.y = s * 0.5; head.add(b); }
  const mouth = box(0.06, 0.014, 0.01, eyeM, 0, -0.09, 0.218); mouth.castShadow = false; head.add(mouth);
  // Hair: a cap over the top and back of the head, plus a style.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.245, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), hair);
  cap.rotation.x = -0.35; cap.position.set(0, 0.02, -0.02); cap.castShadow = true; head.add(cap);
  if (spec.style === "long" || spec.style === "bob") {
    const back = box(0.44, spec.style === "long" ? 0.42 : 0.26, 0.16, hair, 0, spec.style === "long" ? -0.12 : -0.04, -0.12); head.add(back);
    for (const s of [-1, 1]) head.add(box(0.07, spec.style === "long" ? 0.36 : 0.22, 0.2, hair, s * 0.2, spec.style === "long" ? -0.1 : -0.04, 0.0));
  } else if (spec.style === "bun") {
    const bun = round(0.1, hair); bun.position.set(0, 0.2, -0.14); head.add(bun);
  } else if (spec.style === "spiky") {
    for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), hair); const a = -0.9 + i * 0.45; c.position.set(Math.sin(a) * 0.15, 0.22, Math.cos(a) * 0.05 - 0.06); c.rotation.set(-0.5, 0, -a * 0.7); head.add(c); }
  } else if (spec.style === "cap") {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.025, 20, 1, false, -Math.PI / 2, Math.PI), M.std(spec.shirt)); brim.position.set(0, 0.1, 0.13); brim.scale.z = 1.3; head.add(brim);
    cap.material = M.std(spec.capColor || "#2b2b45", { roughness: 0.6 });
  }
  if (spec.glasses) {
    const rimM = M.std("#121020", { metalness: 0.4, roughness: 0.3 });
    for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.011, 6, 18), rimM); r.position.set(s * 0.085, 0.005, 0.215); head.add(r); }
    head.add(box(0.06, 0.012, 0.01, rimM, 0, 0.01, 0.225));
  }
  if (spec.headset) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.018, 6, 24, Math.PI), M.metal("#2a2a3a")); band.position.y = 0.02; head.add(band);
    for (const s of [-1, 1]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16), M.glow(spec.shirt, 2.4)); cup.rotation.z = Math.PI / 2; cup.position.set(s * 0.245, 0, 0); head.add(cup); }
  }
  if (crown) {
    const gold = M.std("#f2c14e", { metalness: 0.8, roughness: 0.25, emissive: "#a36a00", emissiveIntensity: 0.35 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.08, 16, 1, true), gold); ring.position.y = 0.26; head.add(ring);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, c = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 6), gold); c.position.set(Math.sin(a) * 0.15, 0.34, Math.cos(a) * 0.15); head.add(c); }
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), M.glow("#ff4fa3", 3)); gem.position.set(0, 0.27, 0.16); head.add(gem);
  }
  return { root, body, legs, arms, head, eyes, torso, height: 1.5 };
}

// Generated (Meshy) characters have no emission map: bright, saturated texels
// glow a little so their neon trims stand out (same as Kult World).
function addGlow(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      const img = m.map?.image;
      if (!img?.width || m.emissiveMap) continue;
      const w = Math.min(1024, img.width), h = Math.round((img.height / img.width) * w), c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h), p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const mx = Math.max(p[i], p[i + 1], p[i + 2]), mn = Math.min(p[i], p[i + 1], p[i + 2]), sat = mx ? (mx - mn) / mx : 0;
        const k = Math.min(1, Math.max(0, (sat - 0.5) / 0.25)) * Math.min(1, Math.max(0, (mx - 165) / 60)) + 0.08;
        p[i] *= k; p[i + 1] *= k; p[i + 2] *= k;
      }
      g.putImageData(d, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      Object.assign(tex, { flipY: m.map.flipY, colorSpace: THREE.SRGBColorSpace, channel: m.map.channel });
      m.emissiveMap = tex; m.emissive.set("#ffffff"); m.emissiveIntensity = 0.55; m.needsUpdate = true;
    }
  });
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const glbs = new Map();
const loadGLB = (url) => { if (!glbs.has(url)) glbs.set(url, new Promise((res, rej) => loader.load(url, res, undefined, rej))); return glbs.get(url); };

// Status icons over heads: drawn once per kind.
const ICON_TEX = new Map();
function iconTexture(kind) {
  if (ICON_TEX.has(kind)) return ICON_TEX.get(kind);
  const tex = canvasTex(128, 128, (g) => {
    const disc = (fill, ring) => { g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.fillStyle = fill; g.shadowColor = ring; g.shadowBlur = 18; g.fill(); g.shadowBlur = 0; g.lineWidth = 6; g.strokeStyle = ring; g.stroke(); };
    g.lineCap = g.lineJoin = "round";
    if (kind === "done") { disc("#0f3d26", "#6ff0a6"); g.strokeStyle = "#e9fff1"; g.lineWidth = 12; g.beginPath(); g.moveTo(40, 66); g.lineTo(57, 82); g.lineTo(88, 48); g.stroke(); }
    else if (kind === "error") { disc("#4a0f1c", "#ff6b7d"); g.fillStyle = "#fff"; g.fillRect(57, 30, 14, 42); g.beginPath(); g.arc(64, 88, 8, 0, Math.PI * 2); g.fill(); }
    else if (kind === "waiting") { disc("#4a3500", "#ffc94d"); g.fillStyle = "#fff"; g.font = `700 70px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("?", 64, 68); }
    else if (kind.startsWith("dots")) {
      const n = +kind.slice(4);
      g.fillStyle = "rgba(20,14,48,0.85)"; g.beginPath(); g.roundRect(14, 40, 100, 48, 24); g.fill(); g.lineWidth = 4; g.strokeStyle = "rgba(255,255,255,0.5)"; g.stroke();
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(40 + i * 24, 64, 8, 0, Math.PI * 2); g.fillStyle = i < n ? "#ffffff" : "rgba(255,255,255,0.3)"; g.fill(); }
    } else if (kind.startsWith("dice")) {
      const n = +kind.slice(4);
      g.fillStyle = "#fff"; g.shadowColor = "#ffc94d"; g.shadowBlur = 16; g.beginPath(); g.roundRect(24, 24, 80, 80, 16); g.fill(); g.shadowBlur = 0;
      g.fillStyle = "#140c30";
      for (const [x, y] of [[[64, 64]], [[44, 44], [84, 84]], [[44, 44], [64, 64], [84, 84]], [[44, 44], [84, 44], [44, 84], [84, 84]]][n]) { g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill(); }
    }
  });
  ICON_TEX.set(kind, tex);
  return tex;
}

// ------------------------------------------------------------------ the scene
export class OfficeScene {
  // theme: colours and copy for the room (see each world.js).
  // layout: { aisles, corridorX, ceoHome } for walking and the rug.
  constructor(canvas, theme, layout) {
    this.canvas = canvas; this.theme = theme; this.layout = layout;
    this.W = 1; this.H = 1; this.t = 0;
    this.people = new Map();
    this.particles = [];
    this.notes = [];
    this.screen = { mode: "idle", title: "", progress: 0, image: null, lines: [] };
    this.portrait = null;
    this.lightsOn = true; this.exposure = 0.4;
    this.anims = [];
    this.az = Math.PI / 4; this.azTarget = this.az; this.zoom = 1; this.zoomTarget = 1;
    this.screenCanvas = document.createElement("canvas");
    this.screenCanvas.width = 156 * 6; this.screenCanvas.height = 66 * 6;

    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = this.exposure;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(theme.bg);
    s.fog = new THREE.Fog(theme.bg, 60, 120);
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);

    // Lighting: warm key from the open corner, cool rim from the windows, a soft fill.
    s.add(new THREE.HemisphereLight(theme.fill[0], theme.fill[1], 1.8));
    const key = this.key = new THREE.DirectionalLight(theme.key, 2.9);
    key.position.set(ROOM.X * 0.5 + 9, 16, ROOM.Y * 0.5 + 12); key.target.position.set(ROOM.X / 2, 0, ROOM.Y / 2);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 60 });
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    s.add(key, key.target);
    const rim = new THREE.DirectionalLight(theme.rim, 0.6); rim.position.set(-6, 8, 4); s.add(rim);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(s, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.35, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.raycaster = new THREE.Raycaster();
    this.buildRoom();
    this.bindControls();
  }

  // ---------------------------------------------------------------- sizing & camera
  // w, h: the canvas's size in CSS pixels. Anchors and hits use the same units.
  resize(w, h) {
    if (!(w > 0 && h > 0)) return;
    this.W = w; this.H = h;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.frame();
  }
  // Fit the room (any way it is turned) into the canvas.
  frame() {
    const c = this.camera, el = THREE.MathUtils.degToRad(30), center = V(ROOM.X / 2, ROOM.Y / 2, 0.6);
    c.position.set(center.x + Math.sin(this.az) * Math.cos(el) * 40, center.y + Math.sin(el) * 40, center.z + Math.cos(this.az) * Math.cos(el) * 40);
    c.up.set(0, 1, 0); c.lookAt(center); c.updateMatrixWorld(true);
    const inv = c.matrixWorldInverse, b = new THREE.Box2(), p = new THREE.Vector3();
    for (const x of [-0.4, ROOM.X + 0.4]) for (const z of [-0.4, ROOM.Y + 0.4]) for (const y of [-0.7, ROOM.H + 0.3]) { p.set(x, y, z).applyMatrix4(inv); b.expandByPoint(new THREE.Vector2(p.x, p.y)); }
    const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, aspect = this.W / this.H;
    let hw = (b.max.x - b.min.x) / 2 * 1.04, hh = (b.max.y - b.min.y) / 2 * 1.06;
    if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
    hw /= this.zoom; hh /= this.zoom;
    Object.assign(c, { left: cx - hw, right: cx + hw, top: cy + hh, bottom: cy - hh });
    c.updateProjectionMatrix();
  }
  // Drag to turn the room a little, wheel to zoom, double-click to reset.
  bindControls() {
    const c = this.canvas;
    let down = null;
    c.addEventListener("pointerdown", (e) => { down = { x: e.clientX, az: this.azTarget, moved: false }; });
    window.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 4) down.moved = true;
      if (down.moved) this.azTarget = THREE.MathUtils.clamp(down.az - dx * 0.006, Math.PI / 4 - 0.55, Math.PI / 4 + 0.55);
    });
    window.addEventListener("pointerup", () => { this.dragged = down?.moved; down = null; setTimeout(() => { this.dragged = false; }, 0); });
    c.addEventListener("wheel", (e) => { e.preventDefault(); this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * (e.deltaY > 0 ? 0.9 : 1.1), 1, 2.2); }, { passive: false });
    c.addEventListener("dblclick", () => { this.azTarget = Math.PI / 4; this.zoomTarget = 1; });
  }
  // A world point -> canvas CSS pixels.
  toScreen(v) {
    const p = v.clone().project(this.camera);
    return [(p.x + 1) / 2 * this.W, (1 - p.y) / 2 * this.H];
  }
  pick(x, y, objects) {
    this.raycaster.setFromCamera(new THREE.Vector2((x / this.W) * 2 - 1, -(y / this.H) * 2 + 1), this.camera);
    return this.raycaster.intersectObjects(objects, false);
  }

  // ---------------------------------------------------------------- room
  buildRoom() {
    const s = this.scene, th = this.theme, { X, Y, H } = ROOM;
    // The floating slab the room stands on, edged in neon.
    const slab = box(X + 0.8, 0.7, Y + 0.8, M.std(th.slab, { roughness: 0.85 }), X / 2 - 0.1, -0.37, Y / 2 - 0.1);
    slab.castShadow = false; s.add(slab);
    for (const [w, d, x, z] of [[X + 0.84, 0.05, X / 2 - 0.1, Y + 0.32], [0.05, Y + 0.84, X + 0.32, Y / 2 - 0.1]]) s.add(box(w, 0.04, d, M.glow(th.edge, 1.5), x, -0.68, z));
    const under = lightPool(th.edge, 11, 0.2); under.position.set(X / 2, -2.6, Y / 2); s.add(under);
    // Shards drifting below the slab.
    const shards = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.12 + (i % 3) * 0.06), M.glow(th.accents[i % th.accents.length], 1.8));
      const a = (i / 8) * Math.PI * 2 + 0.4;
      m.userData = { x: X / 2 + Math.cos(a) * (X * 0.75), z: Y / 2 + Math.sin(a) * (Y * 0.75), y: -2.2 - (i % 4) * 0.8, ph: i * 1.7 };
      m.scale.y = 1.8; s.add(m); shards.push(m);
    }
    this.anims.push((t) => { for (const m of shards) { const u = m.userData; m.position.set(u.x, u.y + Math.sin(t * 0.8 + u.ph) * 0.3, u.z); m.rotation.y = t * 0.5 + u.ph; } });
    // Stars.
    const n = 260, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 30; pos.set([X / 2 + Math.cos(a) * r, -14 + Math.random() * 34, Y / 2 + Math.sin(a) * r], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    s.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: "#ffffff", size: 2, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false })));

    // Floor: warm wood planks.
    const wood = canvasTex(512, 512, (g) => {
      const tones = th.floor;
      for (let row = 0; row < 16; row++) {
        let x = -((row * 97) % 200);
        while (x < 512) { const len = 140 + ((row * 31 + x) % 5) * 30; g.fillStyle = tones[(row + Math.abs(x)) % tones.length]; g.fillRect(x, row * 32, len, 32); g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x, row * 32, 2, 32); x += len; }
        g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(0, row * 32 + 31, 512, 1);
        g.fillStyle = "rgba(255,255,255,0.05)"; g.fillRect(0, row * 32 + 1, 512, 1);
      }
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 60, 1); }
    }, { repeat: [X / 4, Y / 4] });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(X, Y), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.42, metalness: 0.08 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(X / 2, 0, Y / 2); floor.receiveShadow = true; s.add(floor);
    this.floor = floor;

    // Walls with a skirting, a top cap and a neon line along the top.
    const panel = canvasTex(256, 256, (g) => { g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 256); g.fillStyle = "rgba(0,0,0,0.10)"; g.fillRect(126, 0, 4, 256); g.fillStyle = "rgba(255,255,255,0.06)"; g.fillRect(130, 0, 2, 256); }, { repeat: [1, 1] });
    const wallMat = (len) => { const t = panel.clone(); t.needsUpdate = true; t.repeat.set(len / 2, 1); return new THREE.MeshStandardMaterial({ color: th.wall, map: t, roughness: 0.92 }); };
    const T = 0.2;
    s.add(box(X + T, H, T, wallMat(X), X / 2 - T / 2, H / 2, -T / 2));    // back-right (gy = 0)
    s.add(box(T, H, Y, wallMat(Y), -T / 2, H / 2, Y / 2));                 // back-left (gx = 0)
    s.add(box(X + T, 0.16, 0.05, M.std(th.wallDark), X / 2 - T / 2, 0.08, 0.025), box(0.05, 0.16, Y, M.std(th.wallDark), 0.025, 0.08, Y / 2));
    s.add(box(X + T + 0.04, 0.1, T + 0.04, M.std(th.wallTop), X / 2 - T / 2, H + 0.05, -T / 2), box(T + 0.04, 0.1, Y + 0.02, M.std(th.wallTop), -T / 2, H + 0.05, Y / 2));
    s.add(box(X, 0.035, 0.03, M.glow(th.trim, 2.6), X / 2, H - 0.12, 0.02), box(0.03, 0.035, Y, M.glow(th.trim, 2.6), 0.02, H - 0.12, Y / 2));
    // LED strips along the floor at the foot of the walls.
    s.add(box(X, 0.02, 0.02, M.glow(th.accents[1], 1.6), X / 2, 0.17, 0.06), box(0.02, 0.02, Y, M.glow(th.accents[0], 1.6), 0.06, 0.17, Y / 2));

    this.buildWindows();
    this.buildWhiteboard();
    this.buildWallScreen();
    this.buildNeon();
    this.buildPortrait();
    this.buildClock();
    this.buildRug();
  }

  // Night-city windows on the left wall (unlit material: the lit windows glow).
  buildWindows() {
    const th = this.theme;
    for (const [y0, y1] of [[1.4, 3.8], [8.4, 10.8]]) {
      const w = y1 - y0, cy = (y0 + y1) / 2, sky = canvasTex(512, 384, (g, W, H) => {
        const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, th.sky[0]); grad.addColorStop(1, th.sky[1]); g.fillStyle = grad; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`; g.fillRect(Math.random() * W, Math.random() * H * 0.5, 2, 2); }
        for (let i = 0; i < 12; i++) {
          const bw = 30 + ((i * 37 + y0 * 13) % 40), bh = 90 + ((i * 53 + y0 * 7) % 170), x = i * 44 - 10 + ((y0 * 17) % 20);
          g.fillStyle = "#0b0820"; g.fillRect(x, H - bh, bw, bh);
          for (let wy = H - bh + 12; wy < H - 8; wy += 16) for (let wx = x + 6; wx < x + bw - 6; wx += 11) if (Math.random() < 0.4) { g.fillStyle = th.cityLights[Math.floor(Math.random() * th.cityLights.length)]; g.fillRect(wx, wy, 5, 7); }
        }
      });
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.7), new THREE.MeshBasicMaterial({ map: sky, color: "#ffffff" }));
      glass.rotation.y = Math.PI / 2; glass.position.set(0.012, 1.95, cy); this.scene.add(glass);
      const frame = M.std("#141026", { metalness: 0.5, roughness: 0.4 });
      for (const z of [y0, cy, y1]) this.scene.add(box(0.08, 1.82, 0.07, frame, 0.04, 1.95, z));
      for (const h of [1.1, 2.8]) this.scene.add(box(0.1, 0.08, w + 0.08, frame, 0.04, h, cy));
      const pool = lightPool(th.sky[1], 1.6, 0.25); pool.position.set(1.2, 0.02, cy); this.scene.add(pool);
    }
  }

  buildWhiteboard() {
    const y0 = 4.6, y1 = 7.6;
    this.scene.add(box(0.06, 1.5, y1 - y0 + 0.12, M.metal("#9aa0b8"), 0.03, 1.85, (y0 + y1) / 2));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(y1 - y0, 1.38), M.std("#eef1f8", { roughness: 0.25, emissive: "#ffffff", emissiveIntensity: 0.08 }));
    board.rotation.y = Math.PI / 2; board.position.set(0.065, 1.85, (y0 + y1) / 2); this.scene.add(board);
    this.board = { y0, y1, z0: 1.16, z1: 2.54 };
    this.noteGroup = new THREE.Group(); this.scene.add(this.noteGroup);
    this.scene.add(box(0.12, 0.05, y1 - y0, M.metal("#7a8098"), 0.08, 1.08, (y0 + y1) / 2));
  }

  // The big screen on the back-right wall, painted live by paintScreen().
  buildWallScreen() {
    const x0 = 4.4, x1 = 9.6, h0 = 0.85, h1 = 2.7;
    this.scene.add(box(x1 - x0 + 0.24, h1 - h0 + 0.24, 0.12, M.std("#0b0918", { roughness: 0.3, metalness: 0.5 }), (x0 + x1) / 2, (h0 + h1) / 2, 0.06));
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas); this.screenTex.colorSpace = THREE.SRGBColorSpace; this.screenTex.anisotropy = 8;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, h1 - h0), new THREE.MeshBasicMaterial({ map: this.screenTex, color: new THREE.Color(1.35, 1.35, 1.35) }));
    screen.position.set((x0 + x1) / 2, (h0 + h1) / 2, 0.125); this.scene.add(screen);
    this.screenAt = V((x0 + x1) / 2, 0.15, (h0 + h1) / 2);
    this.scene.add(box(x1 - x0 + 0.28, 0.03, 0.03, M.glow(this.theme.accents[1], 2.4), (x0 + x1) / 2, h0 - 0.14, 0.13));
    const light = new THREE.PointLight(this.theme.screenLight, 3, 9, 1.6); light.position.set((x0 + x1) / 2, 1.8, 1.4); this.scene.add(light);
    const pool = lightPool(this.theme.screenLight, 3.2, 0.22); pool.position.set((x0 + x1) / 2, 0.025, 1.4); this.scene.add(pool);
  }

  // Neon words on a dark plate; each word buzzes on its own.
  buildNeon() {
    const x0 = 10.5, x1 = 13.5, h0 = 1.45, h1 = 2.75, th = this.theme;
    this.scene.add(box(x1 - x0, h1 - h0, 0.06, M.std("#0d0a1c", { roughness: 0.4, metalness: 0.4 }), (x0 + x1) / 2, (h0 + h1) / 2, 0.03));
    for (const [x, h] of [[x0 + 0.12, h0 + 0.12], [x1 - 0.12, h0 + 0.12], [x0 + 0.12, h1 - 0.12], [x1 - 0.12, h1 - 0.12]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8), M.metal("#8a8aa0")); b.rotation.x = Math.PI / 2; b.position.set(x, h, 0.07); this.scene.add(b); }
    this.neonWords = th.neon.map(([word, color], i) => {
      const tex = canvasTex(1024, 256, (g, W, H) => {
        g.font = `700 ${i ? 150 : 170}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle";
        g.shadowColor = color; g.shadowBlur = 30; g.fillStyle = color; g.fillText(word, W / 2, H / 2);
        g.shadowBlur = 6; g.fillStyle = "#ffffff"; g.globalAlpha = 0.6; g.fillText(word, W / 2, H / 2);
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.3, (x1 - x0 - 0.3) / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.2, 1.2, 1.2) }));
      m.position.set((x0 + x1) / 2, h1 - 0.4 - i * 0.5, 0.075); this.scene.add(m);
      return { m, seed: i ? 4.7 : 1.1 };
    });
    const light = new THREE.PointLight(th.neon[0][1], 1.8, 5, 1.8); light.position.set((x0 + x1) / 2, 2.1, 0.8); this.scene.add(light);
  }

  // The CEO's portrait in a gold frame.
  buildPortrait() {
    const x0 = 1.2, x1 = 3.0, h0 = 1.15, h1 = 2.7;
    const gold = M.std("#d2a03a", { metalness: 0.85, roughness: 0.28, emissive: "#6a4300", emissiveIntensity: 0.3 });
    this.scene.add(box(x1 - x0, h1 - h0, 0.08, gold, (x0 + x1) / 2, (h0 + h1) / 2, 0.04));
    this.portraitMat = new THREE.MeshBasicMaterial({ color: "#2b2050" });
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.2, h1 - h0 - 0.2), this.portraitMat);
    pic.position.set((x0 + x1) / 2, (h0 + h1) / 2, 0.085); this.scene.add(pic);
    this.scene.add(box(0.6, 0.05, 0.1, M.glow("#ffd98a", 2.4), (x0 + x1) / 2, h1 + 0.08, 0.1));
    this.portraitAspect = (x1 - x0 - 0.2) / (h1 - h0 - 0.2);
  }
  setPortraitImage(img) {
    if (!img || this.portraitSrc === img) return;
    this.portraitSrc = img;
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) return;
    // Cover-crop to the frame.
    const tex = canvasTex(320, Math.round(320 / this.portraitAspect), (g, W, H) => {
      const k = Math.max(W / w, H / h); g.fillStyle = "#1a1238"; g.fillRect(0, 0, W, H);
      g.drawImage(img, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
    });
    this.portraitMat.map = tex; this.portraitMat.color.set("#ffffff"); this.portraitMat.needsUpdate = true;
  }

  buildClock() {
    const face = document.createElement("canvas"); face.width = face.height = 128;
    const tex = new THREE.CanvasTexture(face); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 32), [M.metal("#2a2440"), new THREE.MeshBasicMaterial({ map: tex }), M.metal("#2a2440")]);
    m.rotation.x = Math.PI / 2; m.position.set(3.65, 2.35, 0.05); this.scene.add(m);
    let last = -1;
    this.anims.push(() => {
      const d = new Date(), sec = d.getSeconds();
      if (sec === last) return; last = sec;
      const g = face.getContext("2d"), hand = (a, len, w, c) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.sin(a) * len, 64 - Math.cos(a) * len); g.stroke(); };
      g.fillStyle = "#f2f0ff"; g.fillRect(0, 0, 128, 128);
      g.fillStyle = "#1a1033"; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.fillRect(62 + Math.sin(a) * 50, 62 - Math.cos(a) * 50, 4, 4); }
      g.lineCap = "round";
      hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, 30, 7, "#1a1033");
      hand((d.getMinutes() / 60) * Math.PI * 2, 44, 5, "#1a1033");
      hand((sec / 60) * Math.PI * 2, 48, 2, "#ff4fa3");
      tex.needsUpdate = true;
    });
  }

  // The CEO's rug in front of the screen (a subclass may draw a pitch on it).
  buildRug() {
    const th = this.theme, w = 4.8, d = 2.5;
    const tex = canvasTex(768, 400, (g, W, H) => this.paintRug(g, W, H));
    const rug = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), [M.std(th.rug), M.std(th.rug), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, emissiveMap: tex, emissive: "#ffffff", emissiveIntensity: 0.12 }), M.std(th.rug), M.std(th.rug), M.std(th.rug)]);
    rug.position.set(this.layout.ceoHome[0], 0.015, this.layout.ceoHome[1] + 0.05); rug.receiveShadow = true; this.scene.add(rug);
    for (const [ww, dd, dx, dz] of [[w, 0.03, 0, -d / 2], [w, 0.03, 0, d / 2], [0.03, d, -w / 2, 0], [0.03, d, w / 2, 0]]) this.scene.add(box(ww, 0.02, dd, M.glow(th.rugEdge, 2.2), rug.position.x + dx, 0.04, rug.position.z + dz));
    const pool = lightPool(th.rugEdge, 3, 0.18); pool.position.set(rug.position.x, 0.05, rug.position.z); this.scene.add(pool);
  }
  paintRug(g, W, H) {
    const th = this.theme;
    g.fillStyle = th.rug; g.fillRect(0, 0, W, H);
    g.strokeStyle = th.rugInner; g.lineWidth = 10; g.strokeRect(26, 26, W - 52, H - 52);
  }

  // ---------------------------------------------------------------- furniture
  // A desk, centre (x, y), 2 x 0.9 tiles; the monitor faces the seat behind it.
  // ledColor lights the strip along its front edge.
  addDesk(x, y, { ledColor = "#4fd8ff", seat = [x - 0.75, y - 0.8] } = {}) {
    const g = new THREE.Group(), th = this.theme; g.position.set(x, 0, y);
    const top = box(2, 0.06, 0.9, M.std(th.desk, { roughness: 0.45 }), 0, 0.74, 0); g.add(top);
    for (const sx of [-0.92, 0.92]) g.add(box(0.06, 0.71, 0.8, M.metal("#2a2540"), sx, 0.355, 0));
    g.add(box(1.8, 0.4, 0.04, M.std(th.deskPanel), 0, 0.5, 0.38));
    const led = box(2.0, 0.025, 0.025, M.glow(ledColor, 2.6), 0, 0.71, 0.46); g.add(led);
    const glow = lightPool(ledColor, 1.4, 0.32); glow.position.set(0, 0.03, 0.75); g.add(glow);
    // Monitor: its back faces the room, its screen the seat.
    const mx = seat[0] - x, mon = new THREE.Group(); mon.position.set(mx, 0.77, 0.12);
    mon.add(box(0.08, 0.22, 0.06, M.metal("#22202e"), 0, 0.11, 0.06), box(0.3, 0.02, 0.2, M.metal("#22202e"), 0, 0.01, 0.06));
    mon.add(box(0.78, 0.46, 0.05, M.std("#1a1828", { roughness: 0.35, metalness: 0.4 }), 0, 0.42, 0));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.4), new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: codeTexture().clone(), emissiveIntensity: 0.25 }));
    scr.material.emissiveMap.needsUpdate = true; scr.rotation.y = Math.PI; scr.position.set(0, 0.42, -0.03); mon.add(scr);
    mon.add(box(0.7, 0.012, 0.012, M.glow(ledColor, 1.8), 0, 0.2, 0.03));
    g.add(mon);
    // Keyboard.
    g.add(box(0.46, 0.02, 0.15, M.std("#24223a"), mx, 0.78, -0.22));
    this.scene.add(g);
    const chair = this.addChair(...seat);
    return { group: g, screen: scr, chair, led, glow, top: 0.77, propAt: (u, v) => V(x + u, y + v, 0.77) };
  }
  addChair(x, y, color = this.theme.chair) {
    const g = new THREE.Group(); g.position.set(x, 0, y);
    g.add(box(0.5, 0.08, 0.46, M.std(color, { roughness: 0.6 }), 0, 0.44, 0));
    g.add(box(0.5, 0.56, 0.08, M.std(color, { roughness: 0.6 }), 0, 0.76, -0.22));
    g.add(box(0.06, 0.38, 0.06, M.metal(), 0, 0.22, 0));
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 5), M.metal()); base.position.y = 0.04; g.add(base);
    this.scene.add(g);
    return g;
  }
  addPlant(x, y, scale = 1) {
    const g = new THREE.Group(); g.position.set(x, 0, y); g.scale.setScalar(scale);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.42, 14), M.std("#b5654a", { roughness: 0.8 })); pot.position.y = 0.21; pot.castShadow = true; g.add(pot);
    g.add(box(0.36, 0.02, 0.36, M.std("#3b2418"), 0, 0.41, 0));
    const leaves = new THREE.Group(); leaves.position.y = 0.42; g.add(leaves);
    const leaf = M.std("#2f8f5b", { roughness: 0.8, flatShading: true }), leaf2 = M.std("#47b877", { roughness: 0.8, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), i % 2 ? leaf : leaf2);
      m.position.set(Math.cos(a) * 0.16, 0.3 + (i % 3) * 0.16, Math.sin(a) * 0.16); m.scale.set(0.8, 1.5, 0.8); m.rotation.z = Math.cos(a) * 0.5; m.castShadow = true; leaves.add(m);
    }
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), leaf2); top.position.y = 0.72; top.castShadow = true; leaves.add(top);
    const ph = x + y;
    this.anims.push((t) => { leaves.rotation.z = Math.sin(t * 1.3 + ph) * 0.04; leaves.rotation.x = Math.cos(t * 1.1 + ph) * 0.03; });
    this.scene.add(g);
  }
  addCooler(x, y) {
    const g = new THREE.Group(); g.position.set(x, 0, y);
    g.add(box(0.46, 0.9, 0.46, M.std("#d8dce8", { roughness: 0.4 }), 0, 0.45, 0));
    g.add(box(0.3, 0.12, 0.02, M.std("#5a6080"), 0, 0.62, 0.235));
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 18), new THREE.MeshStandardMaterial({ color: "#7fc8f8", transparent: true, opacity: 0.7, roughness: 0.1, emissive: "#2f8fd0", emissiveIntensity: 0.3 }));
    bottle.position.y = 1.15; g.add(bottle);
    this.scene.add(g);
  }
  addCoffee(x, y) {
    const g = new THREE.Group(); g.position.set(x, 0, y);
    g.add(box(1.1, 0.8, 0.7, M.std(this.theme.counter, { roughness: 0.5 }), 0, 0.4, 0));
    g.add(box(1.14, 0.04, 0.74, M.std("#e8e4f4", { roughness: 0.3 }), 0, 0.82, 0));
    g.add(box(0.36, 0.5, 0.34, M.std("#1d1b2a", { roughness: 0.3, metalness: 0.5 }), -0.15, 1.09, -0.08));
    g.add(box(0.05, 0.05, 0.02, M.glow("#ff6b4d", 3), -0.06, 1.2, 0.1));
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 12), M.std("#ffffff")); cup.position.set(-0.15, 0.89, 0.04); g.add(cup);
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.09, 12), M.std(this.theme.accents[i % 2])); c.position.set(0.2 + i * 0.11, 0.885, 0.12); g.add(c); }
    this.scene.add(g);
    // Steam rising from the spout.
    const puffs = Array.from({ length: 8 }, (_, i) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: "#f0ecff", transparent: true, depthWrite: false, opacity: 0 })); this.scene.add(m); return { m, i }; });
    this.anims.push((t) => {
      for (const { m, i } of puffs) {
        const k = (t * 0.35 + i / 8) % 1;
        m.position.set(x - 0.15 + Math.sin(k * 6 + i * 1.7) * 0.05, 0.95 + k * 0.8, y + 0.04);
        m.scale.setScalar(0.08 + k * 0.22); m.material.opacity = 0.55 * (1 - k) ** 0.8;
      }
    });
  }
  // The CEO's lectern by the rug.
  addPodium(x, y) {
    const g = new THREE.Group(); g.position.set(x, 0, y);
    g.add(box(0.7, 1.0, 0.4, M.std(this.theme.chair, { roughness: 0.4, metalness: 0.3 }), 0, 0.5, 0));
    const top = box(0.8, 0.06, 0.5, M.std("#1d1830", { metalness: 0.5, roughness: 0.3 }), 0, 1.03, 0.02); top.rotation.x = 0.18; g.add(top);
    g.add(box(0.72, 0.04, 0.02, M.glow("#ffc94d", 2.8), 0, 0.82, 0.21));
    const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.1, 6), M.glow("#ffc94d", 2.2)); emblem.position.set(0, 0.55, 0.205); g.add(emblem);
    this.scene.add(g);
  }

  // ---------------------------------------------------------------- staff
  // Gives a person (from the subclass's roster) a 3D body. Employees are built
  // in code; the CEO is the player's own archetype model when it loads.
  embody(p) {
    const g = new THREE.Group(); g.position.copy(V(p.x, p.y));
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.6, 8), M.hidden()); hit.position.y = 0.8; hit.userData.person = p; g.add(hit);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: glowTexture(), color: "#000000", transparent: true, opacity: 0.45, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.025; g.add(shadow);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false })); icon.scale.setScalar(0.42); icon.visible = false; icon.renderOrder = 10; g.add(icon);
    p.view = { group: g, hit, icon, shadow, rig: null, model: null, mixer: null, actions: {}, current: null, yaw: 0 };
    if (p.isCeo) this.dressCeo(p);
    else { const rig = buildPerson(lookSpec(p.look || p.id, p.color)); p.view.rig = rig; g.add(rig.root); }
    this.scene.add(g);
  }
  unembody(p) { if (p.view) { this.scene.remove(p.view.group); p.view.mixer?.stopAllAction(); p.view = null; } }

  dressCeo(p) {
    const v = p.view, arch = this.ceoArchetype || "hybrid";
    if (!v.rig) { v.rig = buildPerson({ shirt: "#2a2140", hair: "#1c1c3c", style: "short", skin: "#e0ac69", tie: "#d1344b" }, { crown: true }); v.rig.root.scale.setScalar(1.05); v.group.add(v.rig.root); }
    const url = `${this.theme.models}agent-${arch}.glb`;
    v.loading = url;
    loadGLB(url).then((gltf) => {
      if (!p.view || p.view.loading !== url) return;
      const model = SkeletonUtils.clone(gltf.scene);
      model.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(model, true), k = CEO_H / Math.max(0.01, bb.max.y - bb.min.y);
      model.scale.multiplyScalar(k); model.position.y = model.userData.baseY = -bb.min.y * k;
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      addGlow(model);
      if (v.model) v.group.remove(v.model);
      if (v.rig) { v.group.remove(v.rig.root); v.rig = null; }
      v.model = model; v.group.add(model);
      v.mixer = new THREE.AnimationMixer(model); v.actions = {};
      for (const clip of gltf.animations) v.actions[clip.name] = v.mixer.clipAction(clip);
      v.current = null;
      this.ceoPortrait = modelPortrait(gltf);
      this.onCeoModel?.(p);
    }).catch((e) => console.warn("[office] CEO model not loaded, using the drawn CEO", e?.message || e));
  }
  // Clip names differ per model (Walking vs Casual_Walk_inplace): match by keyword.
  play(v, name) {
    if (!v.mixer || v.current === name) return;
    const find = (key) => Object.entries(v.actions).find(([k]) => k.toLowerCase().includes(key))?.[1];
    const next = find(name) || find("idle");
    if (!next) return;
    next.reset().fadeIn(0.25).play();
    if (name === "walk") next.timeScale = 1.35;
    const prev = v.current && find(v.current);
    if (prev && prev !== next) prev.fadeOut(0.25);
    v.current = name;
  }

  isSeated(p) { return !p.isCeo && !p.walking && p.seat && Math.hypot(p.x - p.seat[0], p.y - p.seat[1]) < 0.05; }
  isHappy(p) { return (p.state === "done" && this.t - p.stateAt < 3) || (p.celebrateUntil ?? 0) > this.t; }
  celebrate(seconds = 5) {
    let i = 0;
    for (const p of this.people.values()) { p.celebrateUntil = this.t + seconds + (i++ % 4) * 0.15; p.celebrateFrom = this.t + (i % 3) * 0.12; }
  }

  // Walk along the aisles: to the nearest aisle, along the corridor, then in.
  walkTo(p, [tx, ty], done) {
    const { aisles, corridorX } = this.layout;
    const aisleOf = (y) => aisles.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
    const from = aisleOf(p.y), to = aisleOf(ty), pts = [];
    if (Math.abs(p.y - from) > 0.05) pts.push([p.x, from]);
    if (from !== to) pts.push([corridorX, from], [corridorX, to]);
    pts.push([tx, to]);
    if (Math.abs(ty - to) > 0.05) pts.push([tx, ty]);
    p.path = pts;
    p.onArrive = done || null;
  }

  // Each person's pose for this frame.
  pose(p, dt) {
    const v = p.view;
    if (!v) return;
    const t = this.t, seated = this.isSeated(p), happy = this.isHappy(p), working = p.state === "working";
    v.group.position.set(p.x, 0, p.y);
    // Facing: the way they walk; seated staff face their desk; idle CEO faces the room.
    let yaw = v.yaw;
    if (p.walking && p.path[0]) yaw = Math.atan2(p.path[0][0] - p.x, p.path[0][1] - p.y);
    else if (seated) yaw = 0;
    else if (p.lookAt) yaw = Math.atan2(p.lookAt[0] - p.x, p.lookAt[1] - p.y);
    else yaw = this.az;
    let d = ((yaw - v.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    v.yaw += d * Math.min(1, dt * 10);
    const turn = v.model || v.rig?.root;
    if (turn) turn.rotation.y = v.yaw;
    v.shadow.visible = !seated;
    if (v.mixer) {
      this.play(v, p.walking ? "walk" : happy ? "wave" : "idle");
      v.mixer.update(dt);
      const hop = !p.walking && happy ? Math.abs(Math.sin((t - (p.celebrateFrom ?? 0)) * 7)) * 0.12 : 0;
      v.model.position.y = v.model.userData.baseY + hop;
    }
    const r = v.rig;
    if (r) {
      const ph = p.phase || 0;
      r.root.position.y = seated ? SEAT_H - 0.6 : 0;
      let lift = 0, armX = 0, armZ = 0.08, legX = 0, headX = 0, headY = 0, bodyX = 0;
      if (p.walking) {
        const s = Math.sin(t * 11);
        legX = s * 0.6; armX = -s * 0.5; lift = Math.abs(Math.cos(t * 11)) * 0.05;
      } else if (happy) {
        lift = seated ? 0 : Math.abs(Math.sin((t - (p.celebrateFrom ?? p.stateAt)) * 7)) * 0.14;
        armX = -2.7 + Math.sin(t * 14 + ph) * 0.25; armZ = 0.35;
      }
      r.legs.forEach((l, i) => { l.rotation.x = seated ? -1.45 : (i ? -legX : legX); });
      if (seated && !happy) {
        // Typing while working; now and then while idle, else hands in the lap.
        p.fidgetAt ??= t + 2 + ((ph * 7) % 6);
        if (t > p.fidgetAt + 1.1) p.fidgetAt = t + 4 + Math.random() * 8;
        const typing = working || t > p.fidgetAt;
        r.arms.forEach((a, i) => { a.rotation.x = typing ? -1.25 + Math.sin(t * 22 + i * 2 + ph) * 0.12 : -0.55; a.rotation.z = (i ? -1 : 1) * 0.12; });
        headX = typing ? 0.12 : -0.05; headY = working ? 0 : Math.sin(t * 0.4 + ph) * 0.35;
      } else {
        r.arms.forEach((a, i) => { a.rotation.x = i ? armX : (happy ? armX : -armX); a.rotation.z = (i ? -1 : 1) * armZ; });
      }
      if (p.state === "error") { headX = 0.35; bodyX = 0.12; }
      r.body.position.y = lift;
      r.body.rotation.x = bodyX;
      r.head.rotation.x = headX; r.head.rotation.y = headY;
      r.torso.scale.y = 1 + Math.sin(t * (1.9 + (ph % 0.6)) + ph) * 0.025;
      const blink = (t + ph) % 4.2 < 0.12;
      for (const e of r.eyes) e.scale.y = blink ? 0.2 : 1.35;
    }
    // Status icon over the head.
    const icon = this.iconFor(p);
    v.icon.visible = !!icon;
    if (icon) {
      v.icon.material.map = iconTexture(icon); v.icon.material.needsUpdate = true;
      const lift = p.state === "done" ? Math.min(0.25, (t - p.stateAt) * 0.6) : 0;
      v.icon.position.y = this.headTop(p) + 0.32 + lift + Math.sin(t * 3) * 0.03;
    }
  }
  iconFor(p) {
    const age = this.t - p.stateAt;
    if (p.state === "working") return `dots${Math.floor(this.t * 4) % 4}`;
    if (p.state === "done" && age < 5) return "done";
    if (p.state === "error") return "error";
    if (p.state === "waiting") return "waiting";
    return null;
  }
  headTop(p) { return p.isCeo ? (p.view?.model ? CEO_H : 1.58) : this.isSeated(p) ? SEAT_H - 0.6 + 1.5 : 1.5; }

  // ---------------------------------------------------------------- effects
  // A glowing spark arcs from someone to the big screen.
  packet(fromId, color) {
    const p = this.people.get(fromId);
    if (!p) return;
    const from = V(p.x, p.y, this.headTop(p)), to = this.screenAt.clone();
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3) }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.setScalar(0.7); m.add(halo);
    this.scene.add(m);
    const trail = Array.from({ length: 6 }, (_, i) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 * (1 - i / 6) })); s.scale.setScalar(0.3 * (1 - i / 7)); this.scene.add(s); return s; });
    const at = (k) => from.clone().lerp(to, k).add(new THREE.Vector3(0, Math.sin(k * Math.PI) * 1.6, 0));
    this.particles.push({ t0: this.t, dur: 0.9, step: (k) => { m.position.copy(at(k)); trail.forEach((s, i) => s.position.copy(at(Math.max(0, k - (i + 1) * 0.035)))); }, done: () => { this.scene.remove(m, ...trail); this.burst(to, color); } });
  }
  burst(at, color) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(at); this.scene.add(s);
    this.particles.push({ t0: this.t, dur: 0.5, step: (k) => { s.scale.setScalar(0.4 + k * 1.6); s.material.opacity = 1 - k; }, done: () => this.scene.remove(s) });
  }
  confetti() {
    const n = 140, colors = this.theme.confetti;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.05), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), n);
    const bits = Array.from({ length: n }, (_, i) => {
      mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]).multiplyScalar(1.4));
      return { p: this.screenAt.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 0.6, 0.2)), v: new THREE.Vector3((Math.random() - 0.5) * 2.4, 1.5 + Math.random() * 2.5, 1 + Math.random() * 3), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), w: 4 + Math.random() * 8 };
    });
    this.scene.add(mesh);
    const o = new THREE.Object3D();
    let last = this.t;
    this.particles.push({ t0: this.t, dur: 3.4, step: () => {
      const dt = this.t - last; last = this.t;
      bits.forEach((b, i) => {
        if (b.p.y > 0.02) { b.v.y -= 4.2 * dt; b.v.multiplyScalar(1 - dt * 0.9); b.p.addScaledVector(b.v, dt); b.r.x += b.w * dt; b.r.y += b.w * 0.6 * dt; }
        else { b.p.y = 0.02; b.r.set(-Math.PI / 2, 0, b.r.z); }
        o.position.copy(b.p); o.rotation.copy(b.r); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }, done: () => this.scene.remove(mesh) });
  }
  // One sticky note on the whiteboard per finished step.
  addNote(color) {
    if (this.notes.length >= 24) return;
    const i = this.notes.length, col = i % 6, row = Math.floor(i / 6), b = this.board;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.26), M.std(color, { roughness: 0.8, emissive: color, emissiveIntensity: 0.35 }));
    m.rotation.y = Math.PI / 2; m.rotation.x = (Math.random() - 0.5) * 0.12;
    m.position.set(0.075, b.z1 - 0.2 - row * 0.32, b.y0 + 0.3 + col * 0.48);
    m.scale.setScalar(0.01);
    this.noteGroup.add(m);
    this.notes.push({ color, m, at: this.t });
  }
  clearNotes() { this.noteGroup.clear(); this.notes = []; }

  // ---------------------------------------------------------------- picking
  anchor(id) {
    const p = typeof id === "string" ? this.people.get(id) : id;
    if (!p) return null;
    return this.toScreen(V(p.x, p.y, this.headTop(p) + 0.2));
  }
  hit(x, y) {
    const hits = this.pick(x, y, [...this.people.values()].map((p) => p.view?.hit).filter(Boolean));
    return hits[0]?.object.userData.person || null;
  }

  // ---------------------------------------------------------------- loop
  update(dt) {
    this.t += dt;
    for (const p of this.people.values()) {
      if (!p.path.length) { p.walking = false; continue; }
      p.walking = true;
      const [tx, ty] = p.path[0];
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy), step = WALK_SPEED * dt;
      if (Math.abs(dx - dy) > 0.01) p.facing = dx - dy > 0 ? 1 : -1;
      if (d <= step) {
        p.x = tx; p.y = ty; p.path.shift();
        if (!p.path.length) { p.walking = false; const f = p.onArrive; p.onArrive = null; f?.(); }
      } else { p.x += (dx / d) * step; p.y += (dy / d) * step; }
    }
    for (const p of this.people.values()) this.pose(p, dt);
    this.particles = this.particles.filter((q) => {
      const k = (this.t - q.t0) / q.dur;
      if (k >= 1) { q.done?.(); return false; }
      q.step(k); return true;
    });
    for (const n of this.notes) n.m.scale.setScalar(Math.min(1, (this.t - n.at) * 5));
  }

  draw() {
    const t = this.t;
    // Lights come up as you walk in.
    const target = this.lightsOn ? 1.05 : 0.35;
    this.exposure += (target - this.exposure) * 0.06;
    this.renderer.toneMappingExposure = this.exposure;
    // Turn and zoom ease toward the drag/wheel targets.
    if (Math.abs(this.azTarget - this.az) > 1e-4 || Math.abs(this.zoomTarget - this.zoom) > 1e-4) {
      this.az += (this.azTarget - this.az) * 0.15; this.zoom += (this.zoomTarget - this.zoom) * 0.15; this.frame();
    }
    for (const a of this.anims) a(t);
    for (const w of this.neonWords) {
      const k = Math.sin(t * 17 + w.seed) + Math.sin(t * 5.3 + w.seed * 3), a = (k < -1.75 ? 0.15 : k < -1.55 ? 0.6 : 1) * (0.85 + 0.15 * Math.sin(t * 2.4));
      w.m.material.color.setScalar(1.2 * a);
    }
    if (!this.lastScreen || t - this.lastScreen > 0.1) { this.lastScreen = t; this.paintScreen(); this.screenTex.needsUpdate = true; }
    for (const d of this.deskViews || []) {
      const p = d.person?.();
      const on = p?.state === "working";
      const m = d.screen.material;
      m.emissiveIntensity += ((on ? 0.85 + Math.sin(t * 6) * 0.08 : 0.2) - m.emissiveIntensity) * 0.1;
      if (on) m.emissiveMap.offset.y = (m.emissiveMap.offset.y + 0.004) % 1;
    }
    const portrait = this.portrait?.complete && this.portrait.naturalWidth ? this.portrait : this.ceoPortrait;
    if (portrait) this.setPortraitImage(portrait);
    this.composer.render();
  }

  // ---------------------------------------------------------------- portraits
  // Head-and-shoulders render of a look, as a canvas (for cards and lists).
  portraitOf(look, color) {
    const key = `${look}|${color || ""}`;
    this.portraits ||= new Map();
    if (this.portraits.has(key)) return copyCanvas(this.portraits.get(key));
    const rig = buildPerson(lookSpec(look, color));
    rig.root.rotation.y = -0.35;
    const c = renderPortrait(rig.root, 1.22, 0.55);
    this.portraits.set(key, c);
    return copyCanvas(c);
  }
}

// A procedural screen of code lines for the desk monitors.
const codeTexture = (() => {
  let t;
  return () => t || (t = canvasTex(256, 512, (g, W, H) => {
    g.fillStyle = "#06101e"; g.fillRect(0, 0, W, H);
    const cols = ["#4fd8ff", "#ff7eb6", "#7ee081", "#ffd166", "#c792ea", "#e8e8f0"];
    for (let y = 8; y < H; y += 14) { let x = 10 + ((y * 7) % 40); while (x < W - 20) { const w = 12 + ((x * y) % 50); g.fillStyle = cols[(x + y) % cols.length]; g.fillRect(x, y, w, 6); x += w + 8; if (Math.random() < 0.25) break; } }
  }, { repeat: [1, 1] }));
})();

// An agent model in its idle pose, head and shoulders, as a canvas.
function modelPortrait(gltf) {
  const m = SkeletonUtils.clone(gltf.scene);
  m.updateMatrixWorld(true);
  const idle = gltf.animations.find((c) => /idle/i.test(c.name)) || gltf.animations[0];
  if (idle) { const mx = new THREE.AnimationMixer(m); mx.clipAction(idle).play(); mx.update(0.6); }
  const bb = new THREE.Box3().setFromObject(m, true), k = CEO_H / Math.max(0.01, bb.max.y - bb.min.y);
  m.scale.multiplyScalar(k); m.position.y = -bb.min.y * k; m.rotation.y = -0.3;
  m.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return renderPortrait(m, CEO_H * 0.78, 0.62, 256);
}
// The portrait of an archetype's model (for pickers), or null if it can't load.
export async function archetypePortrait(models, archetype) {
  try { return copyCanvas(modelPortrait(await loadGLB(`${models}agent-${String(archetype || "hybrid").toLowerCase()}.glb`))); }
  catch { return null; }
}

let pr = null;
// Renders an object to a 2D canvas with a shared off-screen renderer.
export function renderPortrait(obj, lookAtY, dist, size = 160) {
  if (!pr) {
    pr = { renderer: new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(30, 1, 0.05, 20) };
    pr.renderer.outputColorSpace = THREE.SRGBColorSpace; pr.renderer.toneMapping = THREE.ACESFilmicToneMapping; pr.renderer.toneMappingExposure = 1.2;
    pr.scene.add(new THREE.HemisphereLight("#e8e0ff", "#3a2a60", 1.8));
    const key = new THREE.DirectionalLight("#ffe0c8", 2.2); key.position.set(-1, 2, 3); pr.scene.add(key);
    const rim = new THREE.DirectionalLight("#4fd8ff", 2.5); rim.position.set(2, 1.5, -2); pr.scene.add(rim);
  }
  pr.renderer.setSize(size, size);
  pr.scene.add(obj);
  pr.camera.position.set(0, lookAtY + 0.05, dist * 2.2); pr.camera.lookAt(0, lookAtY, 0);
  pr.renderer.setClearColor(0x000000, 0);
  pr.renderer.render(pr.scene, pr.camera);
  pr.scene.remove(obj);
  const c = document.createElement("canvas"); c.width = c.height = size;
  c.getContext("2d").drawImage(pr.renderer.domElement, 0, 0);
  return c;
}
const copyCanvas = (src) => { const c = document.createElement("canvas"); c.width = src.width; c.height = src.height; c.getContext("2d").drawImage(src, 0, 0); return c; };
