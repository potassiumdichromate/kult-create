import { Office } from "./world.js";
import { realApi } from "./api.js";
import { createDemoApi } from "./demo.js";
import { renderDashboard, renderTopGames } from "./dashboard.js";

// Kult Create office: entrance → studio registration → the office, where the
// CEO writes a brief and the employees build the game live.

const params = new URLSearchParams(location.search);
const api = params.get("demo") === "1" ? createDemoApi() : realApi;
const embedded = params.get("embed") === "1" || window.parent !== window;

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.style.cssText = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
};
const short = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "");
const show = (id, on = true) => { $(id).hidden = !on; };

const state = {
  cfg: null, agency: null, staff: new Map(), current: null, unsubscribe: null,
  seen: new Set(), done: new Set(), expected: 20, ceoPick: null, wallets: [], productions: []
};

// ------------------------------------------------------------------ office canvas
const canvas = $("office");
const office = new Office(canvas);
office.lightsOn = false;
let scale = 1;

function fit() {
  const box = $("stage").getBoundingClientRect();
  const s = Math.min(box.width / office.W, box.height / office.H);
  scale = s >= 2 ? Math.floor(s) : Math.max(0.5, s);
  canvas.style.width = `${Math.round(office.W * scale)}px`;
  canvas.style.height = `${Math.round(office.H * scale)}px`;
}
new ResizeObserver(fit).observe($("stage"));

const bubbles = new Map(); // employee → { node, until }
function say(id, text) {
  const p = office.person(id);
  if (!p || !text) return;
  let b = bubbles.get(id);
  if (!b) { b = { node: el("div", { class: "bubble" }) }; $("bubbles").append(b.node); bubbles.set(id, b); }
  b.node.replaceChildren(el("b", { style: `color:${shadeText(p.color)}` }, p.name), text.length > 140 ? `${text.slice(0, 139)}…` : text);
  b.node.classList.remove("fade");
  b.until = performance.now() + 6500;
  b.born = performance.now();
  // Keep the floor readable: at most 3 bubbles at once.
  const live = [...bubbles.values()].filter((x) => x.until > performance.now()).sort((a, c) => a.born - c.born);
  while (live.length > 3) live.shift().until = 0;
}
const shadeText = (hex) => (hex === "#e8e8e8" ? "#555" : hex);

function placeBubbles(now) {
  const cRect = canvas.getBoundingClientRect(), sRect = $("stage").getBoundingClientRect();
  for (const [id, b] of bubbles) {
    const a = office.anchor(id);
    if (!a) continue;
    b.node.style.left = `${cRect.left - sRect.left + a[0] * scale}px`;
    b.node.style.top = `${cRect.top - sRect.top + (a[1] - 14) * scale}px`;
    b.node.classList.toggle("fade", now > b.until);
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  office.update(dt);
  office.draw();
  placeBubbles(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

canvas.addEventListener("mousemove", (ev) => {
  const r = canvas.getBoundingClientRect();
  const p = office.hit((ev.clientX - r.left) / scale, (ev.clientY - r.top) / scale);
  const tip = $("tooltip");
  if (!p || !state.agency) { tip.hidden = true; return; }
  const sRect = $("stage").getBoundingClientRect();
  tip.textContent = `${p.name} · ${p.title}${p.state === "working" ? " · working" : ""}`;
  tip.style.left = `${ev.clientX - sRect.left}px`;
  tip.style.top = `${ev.clientY - sRect.top - 8}px`;
  tip.hidden = false;
});
canvas.addEventListener("mouseleave", () => { $("tooltip").hidden = true; });

// ------------------------------------------------------------------ helpers
let toastTimer;
function toast(text, bad = false) {
  const t = $("toast");
  t.textContent = text;
  t.classList.toggle("bad", bad);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

function setCredits(n) {
  if (typeof n !== "number" || !state.agency) return;
  const changed = state.agency.credits !== n;
  state.agency.credits = n;
  $("credits").textContent = n.toLocaleString();
  if ($("credits-big")) $("credits-big").textContent = n.toLocaleString();
  if (changed) { const c = $("credits").parentElement; c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); }
}

function busy(button, on, label) {
  if (on) { button.dataset.label = button.textContent; button.textContent = label || "…"; button.disabled = true; }
  else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
}

// ------------------------------------------------------------------ custom art
// public/office/art/ (built by scripts/import-art.mjs). Without it the office
// keeps its drawn look.
async function loadArt() {
  try {
    const res = await fetch("art/manifest.json", { cache: "no-cache" });
    if (!res.ok) return;
    const manifest = await res.json();
    const groups = [manifest.background ? [manifest.background] : [], Object.values(manifest.sprites || {}), Object.values(manifest.characters || {}), Object.values(manifest.icons || {})];
    const files = [...new Set(groups.flat().map((x) => x.file).filter(Boolean))];
    const images = {};
    await Promise.all(files.map((file) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { images[file] = img; resolve(); };
      img.onerror = resolve;
      img.src = `art/${file}`;
    })));
    if (!office.useArt(manifest, images)) return;
    document.body.classList.add("has-art");
    // Sidebar and HUD icons from the art.
    const icon = (name) => manifest.icons?.[name] && images[manifest.icons[name].file] ? `art/${manifest.icons[name].file}` : null;
    for (const b of document.querySelectorAll(".nav-item")) {
      const src = icon(b.dataset.view);
      if (src) b.querySelector(".ico")?.replaceWith(el("img", { class: "ico", src, alt: "" }));
    }
    const emblem = icon("emblem");
    if (emblem) document.querySelector(".logo")?.replaceChildren(el("img", { src: emblem, alt: "" }));
    const coin = icon("coin");
    if (coin) for (const c of document.querySelectorAll(".coin")) c.replaceWith(el("img", { class: `coin-img${c.classList.contains("big") ? " big" : ""}`, src: coin, alt: "" }));
    requestAnimationFrame(fit);
  } catch (e) {
    console.warn("[kult-create] custom art not loaded", e);
  }
}

// ------------------------------------------------------------------ entrance & registration
async function boot() {
  try {
    state.cfg = await api.config();
  } catch {
    $("entrance-error").textContent = "The studio building is closed right now. Try again in a minute.";
    show("entrance-error");
    return;
  }
  const { credits, employees } = state.cfg;
  $("cost-pro").textContent = credits.pro;
  $("cost-ultra").textContent = credits.ultra;
  $("cost-edit").textContent = credits.edit;
  $("no-agent-create").href = state.cfg.aiArenaUrl || "https://app.kult.games";
  for (const e of employees) state.staff.set(e.id, e);
  await loadArt();
  office.setStaff(employees, null);
  if (embedded) show("exit");
  // Inside Kult World the player is already signed in with Privy: ask the
  // parent page for that session.
  if (privyBridge()) {
    $("connect").textContent = "Sign in with Kult World";
    const session = await requestParentSession(3000);
    if (session) return privySignIn(session);
  }
  if (api.hasSession()) {
    try {
      const me = await api.me();
      return afterSignIn({ wallets: me.wallets, hasAgency: Boolean(me.agency), agency: me.agency });
    } catch { api.signOut(); }
  }
  // Opened directly: the same Privy login as Creator Studio. A player who is
  // still signed in to Privy walks straight in.
  const privy = await loadPrivy();
  if (privy?.authenticated) {
    const session = await privy.tokens().catch(() => null);
    if (session) return privySignIn(session);
  }
  show("entrance");
}

// ------------------------------------------------------------------ Privy (standalone)
// The Privy React SDK lives in a small separate bundle (privy-login/ → ./privy/),
// configured exactly like Creator Studio's. Without it, the office falls back
// to a plain wallet signature.
let privyApi = null;
async function loadPrivy() {
  if (privyApi !== null) return privyApi || null;
  privyApi = false;
  if (api.demo || embedded || !state.cfg?.privy || !state.cfg?.privyAppId) return null;
  try {
    const mod = await import("../privy/kult-privy.js");
    privyApi = await mod.init({ appId: state.cfg.privyAppId, clientId: state.cfg.privyClientId || undefined });
  } catch (e) {
    console.warn("[kult-create] Privy login unavailable, using wallet signature", e);
    privyApi = false;
  }
  return privyApi || null;
}

async function signOutEverywhere() {
  setView("office");
  api.signOut();
  state.agency = null;
  try { await privyApi?.logout?.(); } catch { /* already signed out */ }
  for (const id of ["register", "no-agent", "okx-link", "okx-guide"]) show(id, false);
  show("entrance");
}

// ------------------------------------------------------------------ Kult World (Privy) bridge
// Protocol with the parent page (see public/embed.js):
//   office → parent  { type: "kultcreate:ready" }   send me the player's session
//   office → parent  { type: "kultcreate:login" }   the player must sign in first
//   parent → office  { type: "kultcreate:session", accessToken, identityToken }
//   parent → office  { type: "kultcreate:logout" }
//   office → parent  { type: "kultcreate:exit" }
const privyBridge = () => embedded && !api.demo && Boolean(state.cfg?.privy);
const trustedParent = (origin) => {
  const list = state.cfg?.embedOrigins || [];
  return list.includes("*") || list.includes(origin);
};
let sessionWaiter = null;

function requestParentSession(timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { sessionWaiter = null; resolve(null); }, timeoutMs);
    sessionWaiter = (s) => { clearTimeout(timer); sessionWaiter = null; resolve(s); };
    window.parent.postMessage({ type: "kultcreate:ready" }, "*");
  });
}

window.addEventListener("message", (e) => {
  if (e.source !== window.parent || !trustedParent(e.origin)) return;
  const msg = e.data || {};
  if (msg.type === "kultcreate:session" && (msg.accessToken || msg.identityToken)) {
    const session = { accessToken: msg.accessToken || undefined, identityToken: msg.identityToken || undefined };
    if (sessionWaiter) sessionWaiter(session);
    else if (!state.agency) privySignIn(session); // signed in after a login request
  } else if (msg.type === "kultcreate:logout") {
    api.signOut();
    location.reload();
  }
});

async function privySignIn(session) {
  show("entrance-error", false);
  try {
    return await afterSignIn(await api.privySignIn(session));
  } catch (e) {
    show("entrance");
    $("entrance-error").textContent = e.message;
    show("entrance-error");
  }
}

// Signed in: walk into the studio, or register one if this account has a
// KULT agent to be its CEO.
async function afterSignIn({ wallets, hasAgency, agency }) {
  if (hasAgency) return enterOffice(agency || (await api.me()).agency);
  state.wallets = wallets;
  show("entrance", false);
  let out = { candidates: [] };
  try { out = await api.candidates(); } catch { /* treated as none */ }
  const free = out.candidates.filter((c) => !c.taken);
  if (!free.length) return showNoAgent(wallets, out.candidates.length > 0);
  return showRegister(wallets, out.candidates);
}

function showNoAgent(wallets, allTaken) {
  show("register", false);
  $("no-agent-wallets").textContent = wallets.map(short).join(", ");
  show("no-agent");
  if (allTaken) toast("Your agent already runs a studio. Sign in with the account that owns it.", true);
}

$("no-agent-retry").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  busy(btn, true, "Checking…");
  try { show("no-agent", false); await afterSignIn({ wallets: state.wallets || [], hasAgency: false }); }
  finally { busy(btn, false); }
});

$("connect").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  show("entrance-error", false);
  if (privyBridge()) {
    // Kult World opens its Privy login and then sends us the session.
    busy(btn, true, "Waiting for Kult World…");
    const session = await new Promise((resolve) => {
      const timer = setTimeout(() => { sessionWaiter = null; resolve(null); }, 120_000);
      sessionWaiter = (s) => { clearTimeout(timer); sessionWaiter = null; resolve(s); };
      window.parent.postMessage({ type: "kultcreate:login" }, "*");
    });
    busy(btn, false);
    if (session) await privySignIn(session);
    return;
  }
  const privy = await loadPrivy();
  if (privy) {
    busy(btn, true, "Signing in…");
    try {
      await privy.login();
      await privySignIn(await privy.tokens());
    } catch (e) {
      if (!/closed|exited|cancel/i.test(String(e?.message || e))) {
        $("entrance-error").textContent = e?.message || "Sign-in failed";
        show("entrance-error");
      }
    } finally { busy(btn, false); }
    return;
  }
  busy(btn, true, "Check your wallet…");
  try {
    await afterSignIn(await api.signIn());
  } catch (e) {
    $("entrance-error").textContent = e.message;
    show("entrance-error");
  } finally { busy(btn, false); }
});

// ------------------------------------------------------------------ registration
function showRegister(wallets, candidates) {
  show("no-agent", false);
  show("register");
  $("reg-wallets").textContent = wallets.map(short).join(", ");
  const list = $("ceo-list");
  list.replaceChildren();
  const free = candidates.filter((c) => !c.taken);
  state.ceoPick = free[0];
  const describe = (c) => [c.clan, c.elo ? `ELO ${c.elo}` : null, `INFT #${c.tokenId}`].filter(Boolean).join(" · ");
  if (candidates.length === 1) {
    list.append(el("div", { class: "ceo-card" }, el("span", { class: "crown", "aria-hidden": "true" }, "♛"),
      el("div", {}, el("b", {}, free[0].name), el("br"), el("span", { class: "muted small" }, describe(free[0])))));
    return;
  }
  for (const c of candidates) {
    const btn = el("button", { type: "button", class: "ceo-pick", "aria-pressed": c === state.ceoPick ? "true" : "false", disabled: c.taken || null, onclick: () => {
      for (const b of list.children) b.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-pressed", "true");
      state.ceoPick = c;
    } },
    c.image ? el("img", { src: c.image, alt: "" }) : el("span", { class: "ph" }),
    el("b", {}, c.name), el("span", { class: "muted small" }, c.taken ? "Already runs a studio" : describe(c)));
    list.append(btn);
  }
}

// OKX.ai identity lookup, shared by registration and "link later".
async function lookupOkx(inputId, cardId) {
  const id = $(inputId).value.trim();
  const card = $(cardId);
  if (!id) { card.hidden = true; return null; }
  card.className = "idcard";
  card.replaceChildren(el("span", { class: "muted" }, "Reading X Layer…"));
  card.hidden = false;
  try {
    const me = await api.me();
    const info = await api.okx(id);
    const mine = me.wallets.includes(info.owner) || (info.agentWallet && me.wallets.includes(info.agentWallet));
    const ok = mine && !info.taken;
    card.className = `idcard ${ok ? "good" : "bad"}`;
    card.replaceChildren(
      info.image ? el("img", { src: info.image, alt: "" }) : el("span", { class: "ph" }),
      el("div", {},
        el("b", {}, info.name), el("br"),
        el("span", { class: "small muted" }, `Agent #${info.agentId} · owner ${short(info.owner)}`), el("br"),
        info.taken ? el("span", { class: "small error" }, "This identity already belongs to a studio.")
          : mine ? el("span", { class: "small", style: "color:var(--green)" }, "✓ You control this identity")
            : el("span", { class: "small error" }, "Owned by another wallet. ", el("button", { type: "button", class: "linkish", onclick: () => linkWallet(inputId, cardId) }, "Link that wallet"))));
    return ok ? info : null;
  } catch (e) {
    card.className = "idcard bad";
    card.replaceChildren(el("span", { class: "error" }, e.message));
    return null;
  }
}
$("okx-lookup").addEventListener("click", () => lookupOkx("reg-okx", "okx-card"));
$("reg-okx").addEventListener("change", () => lookupOkx("reg-okx", "okx-card"));

// The OKX identity may sit in a wallet that is not on the Privy account:
// prove that wallet with a signature (OKX Wallet / MetaMask).
async function linkWallet(inputId, cardId) {
  try {
    toast("Switch your wallet to the account that owns the identity, then sign.");
    const out = await api.linkWallet();
    $("reg-wallets").textContent = out.wallets.map(short).join(", ");
    toast("Wallet linked.");
    if ($(inputId).value.trim()) lookupOkx(inputId, cardId);
  } catch (e) { toast(e.message, true); }
}

for (const b of document.querySelectorAll(".sign-out")) b.addEventListener("click", signOutEverywhere);
for (const b of document.querySelectorAll(".okx-guide-open")) b.addEventListener("click", () => show("okx-guide"));
for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", () => show(b.dataset.close, false));
for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.previousElementSibling.textContent); b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 1500); }
    catch { toast("Copy failed. Select the text and copy it manually.", true); }
  });
}

$("register-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("register-error");
  err.hidden = true;
  const btn = $("register-btn");
  busy(btn, true, "Opening…");
  try {
    const okxAgentId = $("reg-okx").value.trim() || undefined;
    const { agency } = await api.register({
      name: $("reg-name").value.trim(), tagline: $("reg-tagline").value.trim(),
      ...(okxAgentId ? { okxAgentId } : {}),
      ...(state.ceoPick ? { ceoTokenId: state.ceoPick.tokenId } : {})
    });
    show("register", false);
    enterOffice(agency, true);
  } catch (e) {
    if (e.data?.code === "NO_AGENT") { showNoAgent(state.wallets || [], false); return; }
    err.textContent = e.message;
    err.hidden = false;
  } finally { busy(btn, false); }
});

// ------------------------------------------------------------------ OKX identity (link later)
function renderOkxBadge(agency) {
  const badge = $("okx-badge");
  if (agency.okxAgentId) {
    badge.className = "badge";
    badge.replaceChildren(agency.okx?.verified ? el("span", { class: "ok" }, "✓ ") : "", `OKX.ai #${agency.okxAgentId}`);
    badge.onclick = null;
  } else {
    badge.className = "badge add";
    badge.textContent = "+ Link OKX.ai";
    badge.title = "Optional: use your studio commercially on OKX.ai";
    badge.onclick = () => { show("okx-link-error", false); show("okx-link"); $("okx-link-id").focus(); };
  }
}
$("okx-link-check").addEventListener("click", () => lookupOkx("okx-link-id", "okx-link-card"));
$("okx-link-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = $("okx-link-btn");
  busy(btn, true, "Linking…");
  try {
    const { agency } = await api.linkOkx($("okx-link-id").value.trim());
    state.agency = { ...state.agency, ...agency };
    renderOkxBadge(state.agency);
    show("okx-link", false);
    logSystem(`Linked OKX.ai identity #${agency.okxAgentId}. Your studio is now discoverable on OKX.ai.`);
    say("ceo", "We're on OKX.ai now. Let's take on some commercial work!");
  } catch (e) {
    $("okx-link-error").textContent = e.message;
    show("okx-link-error");
  } finally { busy(btn, false); }
});

// ------------------------------------------------------------------ office
async function enterOffice(agency, fresh = false) {
  state.agency = agency;
  for (const id of ["entrance", "register", "no-agent"]) show(id, false);
  show("hud"); show("console"); show("feed"); show("sidebar");
  $("studio-name").textContent = agency.name;
  $("studio-tagline").textContent = agency.tagline || "";
  renderOkxBadge(agency);
  $("ceo-badge").textContent = `CEO ${agency.ceo?.name || `#${agency.ceoTokenId}`}`;
  setCredits(agency.credits);
  $("credits").textContent = agency.credits.toLocaleString();
  office.setStaff(state.cfg.employees, agency.ceo);
  if (agency.ceo?.image) { const img = new Image(); img.crossOrigin = "anonymous"; img.src = agency.ceo.image; office.portrait = img; }
  office.lightsOn = true;
  office.screen = { mode: "idle", title: agency.name, progress: 0, image: null, lines: [] };
  requestAnimationFrame(fit);
  logSystem(fresh ? `Welcome to ${agency.name}! You have ${agency.credits.toLocaleString()} credits. Write a brief to start your first game.` : `Welcome back to ${agency.name}.`);
  setTimeout(() => say("ceo", fresh ? "Team, we're open for business!" : "Morning, team. What are we making today?"), 600);
  try {
    const { productions } = await api.agency();
    state.productions = productions;
    const running = productions.find((p) => p.status === "running");
    if (running) attach(running.id);
  } catch { /* office still usable */ }
}

$("exit").addEventListener("click", () => window.parent.postMessage({ type: "kultcreate:exit" }, "*"));

// Brief → production
$("brief-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const brief = $("brief").value.trim();
  const mode = new FormData(ev.currentTarget).get("mode");
  if (brief.length < 8) { toast("Describe the game in a sentence or two.", true); $("brief").focus(); return; }
  const btn = $("start");
  busy(btn, true, "Briefing the team…");
  try {
    const out = await api.start({ brief, mode });
    setCredits(out.credits);
    logSystem(`CEO brief (${mode.toUpperCase()}, ${out.production.cost} credits): ${brief}`);
    say("ceo", brief.length > 90 ? `${brief.slice(0, 88)}… Let's go!` : `${brief} Let's go!`);
    $("brief").value = "";
    attach(out.production.id);
  } catch (e) {
    toast(e.message, true);
  } finally { busy(btn, false); }
});

function setWorking(on, text) {
  show("brief-form", !on);
  show("working", on);
  $("console-status").textContent = on ? "In production" : "Your team is ready.";
  if (text) $("working-text").textContent = text;
}

function attach(id) {
  state.unsubscribe?.();
  state.seen = new Set(); state.done = new Set();
  setWorking(true, "The team is on it.");
  state.unsubscribe = api.subscribe(id, (e) => handle(e));
}

function handle(e) {
  if (e.type === "snapshot") {
    const p = e.production;
    state.current = p;
    state.expected = p.kind === "edit" ? 7 : p.mode === "ultra" ? 21 : 19;
    office.resetStates();
    office.screen = { mode: "work", title: p.brief, progress: 0, image: null, lines: [] };
    state.seen = new Set(); state.done = new Set();
    for (const ev of p.timeline || []) apply(ev, true);
    if (p.status === "complete") finish(p.result, true);
    else if (p.status === "failed") failed(p.error, p.refunded, true);
    return;
  }
  apply(e, false);
}

function apply(e, replay) {
  if (e.type === "progress") {
    if (!replay) say(e.employee, `Writing code… ${(e.chars / 1000).toFixed(1)}k characters so far`);
    return;
  }
  if (e.type === "status") {
    if (e.status === "complete") finish(e.result, replay);
    else failed(e.error, e.refunded, replay);
    return;
  }
  if (e.type !== "employee") return;
  const staff = state.staff.get(e.employee) || {};
  office.setState(e.employee, e.state);
  state.seen.add(e.nodeId);
  if (e.state === "done" || e.state === "error") {
    state.done.add(e.nodeId);
    if (e.state === "done") office.addNote(staff.color || "#ffd166");
    office.screen.lines.push(`${e.nodeId.replace(/^sprite:/, "")} ✓`);
  }
  if (e.image) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = e.image;
    office.screen.image = img;
    if (!replay) office.packet(e.employee, staff.color || "#fff");
  }
  const total = Math.max(state.expected, state.seen.size + 1);
  const progress = Math.min(0.96, state.done.size / total);
  office.screen.progress = progress;
  $("progress-bar").style.width = `${Math.round(progress * 100)}%`;
  if (e.state === "working") $("working-text").textContent = `${staff.name || "The team"} (${staff.title || ""}): ${e.line}`;
  logLine(e, staff, replay);
  if (!replay) {
    say(e.employee, e.line);
    if (e.state === "working" && e.employee !== "ceo") office.visit(e.employee);
  }
}

function logLine(e, staff, replay) {
  const log = $("log");
  log.querySelector(".empty")?.remove();
  const name = e.employee === "ceo" ? state.agency?.ceo?.name || "CEO" : staff.name;
  const li = el("li", { class: e.state === "error" ? "error" : "", style: `--c:${staff.color || "#888"}` },
    el("span", { class: "dot" }),
    el("div", {}, el("span", { class: "who" }, `${name} · ${staff.title || ""}`), e.line, e.image ? el("img", { src: e.image, alt: "", loading: "lazy" }) : null));
  log.append(li);
  while (log.children.length > 120) log.firstElementChild.remove();
  if (!replay || log.children.length < 4) li.scrollIntoView({ block: "end", behavior: replay ? "auto" : "smooth" });
}

function logSystem(text) {
  const log = $("log");
  log.querySelector(".empty")?.remove();
  log.append(el("li", { class: "system" }, el("span", { class: "dot" }), el("div", {}, el("span", { class: "who" }, "Studio"), text)));
  log.lastElementChild.scrollIntoView({ block: "end" });
}

function finish(result, replay) {
  state.unsubscribe?.(); state.unsubscribe = null;
  setWorking(false);
  for (const p of office.people.values()) if (p.state === "working") office.setState(p.id, "done");
  office.screen.mode = "done";
  office.screen.progress = 1;
  office.screen.title = result?.title || "";
  if (result?.coverUrl) { const img = new Image(); img.crossOrigin = "anonymous"; img.src = result.coverUrl; office.screen.image = img; }
  $("progress-bar").style.width = "100%";
  if (replay) return;
  office.confetti();
  say("ceo", `"${result?.title || "Our game"}" is done. Great work, everyone!`);
  logSystem(`"${result?.title}" shipped. Play it, publish it, or ask for changes.`);
  setTimeout(() => openResult(state.current, result), 1400);
  refreshAgency();
}

function failed(error, refunded, replay) {
  state.unsubscribe?.(); state.unsubscribe = null;
  setWorking(false);
  office.screen.mode = "failed";
  if (replay) return;
  say("ceo", "That one didn't come together. Let's try again.");
  logSystem(`Production failed: ${error || "unknown error"}.${refunded ? ` ${refunded} credits refunded.` : ""}`);
  toast(`Production failed. ${refunded ? `${refunded} credits refunded.` : ""}`, true);
  refreshAgency();
}

async function refreshAgency() {
  try {
    const { agency, productions } = await api.agency();
    state.productions = productions;
    setCredits(agency.credits);
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------ result
// ------------------------------------------------------------------ sidebar views
// Office (the floor) and the CEO-only Dashboard; Studio opens the settings sheet.
const PANELS = { dashboard: "dashboard", games: "games-view", credits: "credits-view" };
function setView(view) {
  if (view === "studio") { openStudioSettings(); return; }
  document.body.classList.toggle("view-panel", view in PANELS);
  for (const [name, id] of Object.entries(PANELS)) show(id, name === view);
  for (const b of document.querySelectorAll(".nav-item")) {
    const active = b.dataset.view === view;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  if (view === "dashboard") loadDashboard();
  else if (view === "games") loadTopGames();
  else if (view === "credits") renderCreditsView();
  else requestAnimationFrame(fit);
}
for (const b of document.querySelectorAll(".nav-item")) b.addEventListener("click", () => setView(b.dataset.view));

// Top games across every Kult Create studio.
async function loadTopGames() {
  const root = $("games-body");
  if (!root.querySelector(".top-list")) root.replaceChildren(el("p", { class: "muted" }, "Loading top games…"));
  try {
    const { games } = await api.topGames();
    renderTopGames(root, games, { onPlay: playTopGame });
  } catch (e) {
    root.replaceChildren(el("p", { class: "error" }, e.status === 503 || e.status === 502 ? "Top games are unavailable right now (Creator Studio didn't answer). Try again in a minute." : e.message));
  }
}
$("games-refresh").addEventListener("click", loadTopGames);

function playTopGame(g) {
  $("player-title").textContent = g.title;
  $("player-studio").textContent = g.mine ? "Your studio" : `By ${g.studio?.name || "a Kult Create studio"}`;
  $("player-stats").textContent = `${(g.plays || 0).toLocaleString()} plays · ${(g.likes || 0).toLocaleString()} likes · ${(g.comments || 0).toLocaleString()} comments`;
  $("player-2").src = g.playUrl;
  $("player-full").href = g.playUrl;
  const live = $("player-live");
  live.hidden = !g.livePageUrl;
  if (g.livePageUrl) live.href = g.livePageUrl;
  show("player-sheet");
}
$("player-close").addEventListener("click", () => { show("player-sheet", false); $("player-2").src = "about:blank"; });

// Credits: the balance and a way to add more.
function renderCreditsView() {
  $("credits-big").textContent = (state.agency?.credits ?? 0).toLocaleString();
  const c = state.cfg?.credits || {};
  $("cost-pro-2").textContent = c.pro ?? 40;
  $("cost-ultra-2").textContent = c.ultra ?? 100;
  $("cost-edit-2").textContent = c.edit ?? 10;
}
$("add-credits").addEventListener("click", () => show("credits-sheet"));

let dashLoading = null;
async function loadDashboard() {
  const bodyEl = $("dash-body");
  if (!bodyEl.children.length || bodyEl.querySelector(".muted")) bodyEl.replaceChildren(el("p", { class: "muted" }, "Loading your studio…"));
  const range = $("dash-range").value;
  const request = (dashLoading = api.dashboard(range));
  try {
    const data = await request;
    if (request !== dashLoading) return; // a newer load won
    if (data.studio?.credits !== undefined) setCredits(data.studio.credits);
    $("dash-notice").textContent = data.engagement === "ok" ? "" : "Plays, likes and comments are unavailable right now (Creator Studio didn't answer). Studio numbers below are up to date.";
    show("dash-notice", data.engagement !== "ok");
    renderDashboard(bodyEl, data, {
      onOpenGame: openGameFromDashboard,
      onPublishGame: publishFromDashboard,
      onLinkOkx: () => { show("okx-link-error", false); show("okx-link"); }
    });
  } catch (e) {
    bodyEl.replaceChildren(el("p", { class: "error" }, e.message));
  }
}
$("dash-range").addEventListener("change", () => loadDashboard());
$("dash-refresh").addEventListener("click", () => loadDashboard());

async function openGameFromDashboard(game) {
  try {
    const { production } = await api.production(game.latestId);
    openResult(production, production.result);
  } catch (e) { toast(e.message, true); }
}

async function publishFromDashboard(game) {
  try {
    toast("Publishing to Creator Studio…");
    await api.publish(game.latestId, true);
    toast(`"${game.title}" is live on Creator Studio.`);
    loadDashboard();
  } catch (e) { toast(e.message, true); }
}

function openStudioSettings() {
  const a = state.agency;
  if (!a) return;
  const facts = [
    ["Studio", a.name], ["Tagline", a.tagline || "—"],
    ["CEO", `${a.ceo?.name || "Agent"} (INFT #${a.ceoTokenId})`],
    ["OKX.ai", a.okxAgentId ? `#${a.okxAgentId} ${a.okx?.name ? `· ${a.okx.name}` : ""}` : "Not linked (optional)"],
    ["Wallets", (a.ownerWallets || []).map(short).join(", ")],
    ["Credits", (a.credits ?? 0).toLocaleString()],
    ["Since", new Date(a.createdAt || Date.now()).toLocaleDateString()]
  ];
  $("studio-facts").replaceChildren(...facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
  show("studio-okx", !a.okxAgentId);
  show("studio-settings");
}
$("studio-okx").addEventListener("click", () => { show("studio-settings", false); show("okx-link-error", false); show("okx-link"); });

function openResult(production, result) {
  if (!result) return;
  state.resultFor = production;
  $("result-title").textContent = result.title || "Your game";
  const q = result.quality || {};
  $("result-quality").textContent = [q.acceptance === true ? "Acceptance tests passed" : q.acceptance === false ? "Acceptance tests had issues" : null, q.playtest ? `Playtest: ${q.playtest}` : null].filter(Boolean).join(" · ");
  $("player").src = result.playUrl || "about:blank";
  $("open-new-tab").href = result.playUrl || "#";
  const pub = production?.published;
  setPublished(pub);
  show("result-error", false);
  show("result");
}

function setPublished(pub) {
  const done = pub?.status === "published";
  $("publish").disabled = done;
  $("publish").textContent = done ? "Published ✓" : "Publish to Creator Studio";
  const link = $("published-link");
  link.hidden = !(done && pub.playUrl);
  if (pub?.playUrl) link.href = pub.playUrl;
}

$("result-close").addEventListener("click", () => { show("result", false); $("player").src = "about:blank"; });
$("publish").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  busy(btn, true, "Publishing…");
  try {
    const { published } = await api.publish(state.resultFor.id, true);
    state.resultFor.published = published;
    busy(btn, false);
    setPublished(published);
    say("publisher", "It's live on Kult Creator Studio!");
    logSystem(`Published "${$("result-title").textContent}" to Creator Studio.`);
    office.confetti();
  } catch (e) {
    busy(btn, false);
    $("result-error").textContent = e.message;
    show("result-error");
  }
});

$("edit-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const text = $("edit-text").value.trim();
  if (text.length < 4) return;
  try {
    const out = await api.edit(state.resultFor.id, text);
    setCredits(out.credits);
    $("edit-text").value = "";
    show("result", false);
    $("player").src = "about:blank";
    logSystem(`CEO change request (${out.production.cost} credits): ${text}`);
    say("ceo", `Change request: ${text}`);
    attach(out.production.id);
  } catch (e) {
    $("result-error").textContent = e.message;
    show("result-error");
  }
});

// ------------------------------------------------------------------ history
$("history-btn").addEventListener("click", async () => {
  await refreshAgency();
  const list = $("history-list");
  list.replaceChildren();
  if (!state.productions.length) list.append(el("li", { class: "muted" }, "No games yet. Write your first brief!"));
  for (const p of state.productions) {
    const r = p.result;
    const tag = p.status === "complete" ? (p.published?.status === "published" ? ["Published", "ok"] : ["Ready", "ok"]) : p.status === "running" ? ["Working", "run"] : ["Failed", "bad"];
    list.append(el("li", {},
      r?.coverUrl ? el("img", { src: r.coverUrl, alt: "" }) : el("span", { class: "ph" }),
      el("div", {}, el("b", {}, r?.title || p.brief.slice(0, 40)), el("span", { class: `tag ${tag[1]}` }, tag[0]), el("br"),
        el("span", { class: "small muted" }, `${p.kind === "edit" ? "Change" : p.mode?.toUpperCase()} · ${p.cost} credits · ${new Date(p.createdAt).toLocaleString()}`)),
      p.status === "complete" ? el("button", { class: "btn small", onclick: () => { show("history", false); openResult(p, r); } }, "Open") : el("span")));
  }
  show("history");
});
$("history-close").addEventListener("click", () => show("history", false));

boot();
