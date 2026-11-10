import { Office } from "./world.js";
import { realApi } from "./api.js";
import { createDemoApi } from "./demo.js";
import { renderDashboard, renderTopGames } from "./dashboard.js";
import { createTour } from "./tour.js";

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
// The "Opening the studio…" loader stays up until the first real screen appears.
const SCREENS = new Set(["entrance", "register", "no-agent", "hud"]);
const show = (id, on = true) => {
  $(id).hidden = !on;
  if (on && SCREENS.has(id)) $("booting").hidden = true;
};

const state = {
  cfg: null, agency: null, staff: new Map(), current: null, unsubscribe: null,
  seen: new Set(), done: new Set(), expected: 20, ceoPick: null, wallets: [], productions: []
};

// ------------------------------------------------------------------ office canvas
const canvas = $("office");
const office = new Office(canvas);
if (new URLSearchParams(location.search).has("debug")) window.kc = { office };
office.lightsOn = false;
let scale = 1;

function fit() {
  const box = $("stage").getBoundingClientRect();
  if (!box.width || !box.height) return; // hidden (another view is open)
  office.setInsets(stageInsets(box));
  office.resize(box.width, box.height);
}

// On desktop the office fills the screen and panels float over it: frame the
// room in the space they leave (the canvas still draws behind them).
function stageInsets(box) {
  if (getComputedStyle($("stage")).position !== "fixed") return { top: 0, right: 0, bottom: 0, left: 0 };
  const r = (id) => { const n = $(id); return n && !n.hidden && n.getClientRects().length ? n.getBoundingClientRect() : null; };
  const hud = r("hud"), feed = r("feed"), con = r("console"), nav = r("sidebar");
  // The nav is a rail on the left on desktop (a bar along the bottom on phones).
  const rail = nav && nav.right < box.left + box.width / 3 ? nav : null;
  const lows = [con, !rail ? nav : null].filter(Boolean).map((x) => x.top);
  return {
    top: hud ? hud.bottom - box.top + 6 : 0,
    right: feed ? box.right - feed.left + 6 : 0,
    bottom: lows.length ? box.bottom - Math.min(...lows) + 6 : 0,
    left: rail ? rail.right - box.left + 6 : 16
  };
}
{
  const ro = new ResizeObserver(() => fit());
  for (const id of ["stage", "hud", "feed", "console", "sidebar"]) if ($(id)) ro.observe($(id));
}

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

// ------------------------------------------------------------------ entrance & registration
async function boot() {
  try {
    state.cfg = await api.config();
  } catch {
    $("entrance-error").textContent = "The studio building is closed right now. Try again in a minute.";
    show("entrance-error");
    show("entrance");
    return;
  }
  const { credits, employees } = state.cfg;
  $("cost-pro").textContent = credits.pro;
  $("cost-ultra").textContent = credits.ultra;
  $("cost-edit").textContent = credits.edit;
  $("no-agent-create").href = state.cfg.aiArenaUrl || "https://app.kult.games";
  for (const e of employees) state.staff.set(e.id, e);
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
  setTimeout(() => { if (isShown("register")) tour.offer("r-hello", forceTour); }, 400);
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
  $(`${cardId}-sign`)?.remove();
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
            : el("span", { class: "small error" }, "Owned by another wallet. ",
              el("button", { type: "button", class: "linkish", onclick: () => linkWallet(inputId, cardId) }, "Link that wallet"),
              " or ",
              el("button", { type: "button", class: "linkish", onclick: () => signElsewhere(info, inputId, cardId) }, "sign with OKX Agentic Wallet"))));
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

// OKX Agentic Wallet keys live in OKX's enclave, so that wallet can't sign in
// this browser. Show the challenge as an `onchainos` command; the owner runs
// it (or has their agent sign the message) and pastes the signature back.
async function signElsewhere(info, inputId, cardId) {
  const panelId = `${cardId}-sign`;
  $(panelId)?.remove();
  let ch;
  try { ch = await api.linkChallenge(info.owner); } catch (e) { toast(e.message, true); return; }
  // One line, "\n" written out: the CLI signs it literally and the server accepts that form.
  const command = `onchainos wallet sign-message --type personal --chain 196 --from ${info.owner} --message "${ch.message.replace(/\n/g, "\\n")}"`;
  const sig = el("textarea", { rows: 2, placeholder: "0x…", spellcheck: "false", autocomplete: "off" });
  const go = el("button", { type: "button", class: "btn primary small", onclick: async () => {
    const signature = sig.value.trim();
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) { toast("Paste the signature: 0x followed by 130 hex characters.", true); return; }
    busy(go, true, "Linking…");
    try {
      const out = await api.linkWithSignature({ nonce: ch.nonce, signature });
      $("reg-wallets").textContent = out.wallets.map(short).join(", ");
      toast("Wallet linked.");
      lookupOkx(inputId, cardId);
    } catch (e) { busy(go, false); toast(e.message, true); }
  } }, "Link wallet");
  $(cardId).after(el("div", { id: panelId, class: "sign-elsewhere" },
    el("p", { class: "small" }, `Sign with the wallet that owns agent #${info.agentId} (${short(info.owner)}). It costs no gas and sends nothing on-chain.`),
    el("p", { class: "small muted" }, "Run this command, or ask your agent to sign the message with your OKX Agentic Wallet:"),
    copyRow(command),
    el("details", {}, el("summary", { class: "small muted" }, "Show the message"), el("pre", {}, ch.message)),
    el("label", { class: "field" }, "Signature", sig),
    el("div", { class: "sign-foot" },
      el("span", { class: "small muted" }, `Expires at ${new Date(ch.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`),
      go)));
}

function copyRow(text) {
  const btn = el("button", { type: "button", class: "btn small", onclick: async () => {
    try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1500); }
    catch { toast("Copy failed. Select the text and copy it manually.", true); }
  } }, "Copy");
  return el("div", { class: "copy" }, el("code", {}, text), btn);
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
  // ?archetype=berserker previews another CEO look (demo / design checks).
  const preview = params.get("archetype");
  office.setStaff(state.cfg.employees, preview ? { ...agency.ceo, archetype: preview } : agency.ceo);
  if (agency.ceo?.image) { const img = new Image(); img.crossOrigin = "anonymous"; img.src = agency.ceo.image; office.portrait = img; }
  office.lightsOn = true;
  office.screen = { mode: "idle", title: agency.name, progress: 0, image: null, lines: [] };
  fit(); requestAnimationFrame(fit); // now, and again once the panels have laid out
  logSystem(fresh ? `Welcome to ${agency.name}! You have ${agency.credits.toLocaleString()} credits. Write a brief to start your first game.` : `Welcome back to ${agency.name}.`);
  setTimeout(() => say("ceo", fresh ? "Team, we're open for business!" : "Morning, team. What are we making today?"), 600);
  try {
    const { productions } = await api.agency();
    state.productions = productions;
    const running = productions.find((p) => p.status === "running");
    if (running) attach(running.id);
  } catch { /* office still usable */ }
  // A player who opened the studio mid-tour carries on with it; anyone else new gets it here.
  if (!tour.running) setTimeout(() => { if (state.agency && !document.body.classList.contains("panel-open")) tour.offer("o-hello", forceTour); }, 1500);
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
  office.celebrate(5);
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
  document.body.classList.toggle("panel-open", view in PANELS);
  for (const [name, id] of Object.entries(PANELS)) show(id, name === view);
  for (const b of document.querySelectorAll(".nav-item")) {
    const active = b.dataset.view === view;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  if (view === "dashboard") loadDashboard();
  else if (view === "games") loadTopGames();
  else if (view === "credits") renderCreditsView();
  else fit();
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
      onLinkOkx: () => { show("okx-link-error", false); show("okx-link"); },
      portraitOf: (id) => office.portraitOf(id)
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

// ------------------------------------------------------------------ tutorial
// Nova, the KULT guide (the same tutorial as Kult World's, js/tour.js), walks a
// new player through opening the studio and around the office. Once per
// player; the top bar's Tutorial button or ?tour shows it again.
const forceTour = params.has("tour");
const isShown = (id) => !$(id).hidden;
const viewOpen = (id) => isShown(id) && document.body.classList.contains("panel-open");
const navSel = (v) => `#sidebar [data-view="${v}"]`;
const TOUR_LINES = {
  "r-hello": "Hi, I'm Nova, your KULT guide! Kult Create is a game studio run by AI: your KULT agent is the CEO, ten AI employees build the games, and you publish them to Creator Studio. Let's open your studio.",
  "r-ceo": "Your CEO is your own KULT agent, your AI Arena INFT on 0G. It writes the briefs and runs the team.",
  "r-name": "Name your studio and give it a tagline. Players see both on every game you publish.",
  "r-okx": "Optional: link your OKX.ai identity so people and agents on OKX.ai can hire your studio. You can also do it later from the top bar.",
  "r-go": "Ready? Open your studio!",
  "o-hello": "Welcome to your studio! Your producer, designers, artists, engineer, QA and playtester work on this floor. Let me show you around.",
  "o-hud": "Up top: your studio, your CEO and your credits. Every game costs credits, and you start with plenty.",
  "o-okx": "Your OKX.ai identity. Link it and your studio is listed on OKX.ai, where buyers can hire it to build games.",
  "o-feed": "The studio floor. Your team talks here while they work, from the first design to the final playtest.",
  "o-brief": "This is where it starts. Pitch a game to your team in a sentence or two: the theme, how you play, how you win.",
  "o-modes": "Pick the quality. PRO gets drawn sprites, a painted scene and a phone playtest. ULTRA uses the top models, more sprites and extra QA fixes.",
  "o-start": "Then press Start production. You'll watch the team build it live, play it when it's done, ask for changes and publish it.",
  "o-dash-go": "Open the Dashboard.",
  "o-dash": "Your CEO dashboard: games made, plays, likes and credits spent, by day, week, month or year.",
  "o-games-go": "Now open Games.",
  "o-games": "The most-played games from every studio in Kult Create. Tap Play to try one and see what everyone else is making.",
  "o-credits-go": "Open Credits.",
  "o-credits": "Your studio wallet: what each game costs, and where to add credits when you run low.",
  "o-studio": "Studio holds your settings: your name and tagline, your CEO and your OKX.ai link.",
  "o-office-go": "Back to the floor.",
  "o-done": "You're all set. Write your first brief and watch your team build it. Have fun, CEO!"
};
const tour = createTour({
  guide: { img: "art/nova.png", name: "NOVA" },
  lines: TOUR_LINES,
  doneKeys: () => [state.wallets?.[0] && `kc.tour.v1.${String(state.wallets[0]).toLowerCase()}`, state.agency?.id && `kc.tour.v1.${state.agency.id}`].filter(Boolean),
  onFinish: () => { office.celebrate?.(4); say("ceo", "Alright team, let's make something great!"); },
  steps: [
    // Opening the studio.
    { id: "r-hello", phase: "register", next: true, nextLabel: "Let's go", title: "Welcome to Kult Create" },
    { id: "r-ceo", phase: "register", target: "#ceo-list", next: true, interactive: true },
    { id: "r-name", phase: "register", target: "#reg-name, #reg-tagline", next: true, interactive: true },
    { id: "r-okx", phase: "register", target: "#okx-section", next: true, interactive: true },
    { id: "r-go", phase: "register", target: "#register-btn", done: () => Boolean(state.agency) && !isShown("register"), doneDelay: 1200 },
    // The office.
    { id: "o-hello", phase: "office", next: true, quiet: () => !state.agency },
    { id: "o-hud", phase: "office", target: "#hud", next: true },
    { id: "o-okx", phase: "office", target: "#okx-badge", next: true, skip: () => !$("okx-badge").getClientRects().length },
    { id: "o-feed", phase: "office", target: "#feed", next: true, skip: () => !$("feed").getClientRects().length },
    { id: "o-brief", phase: "office", target: "#brief", next: true, interactive: true, skip: () => !isShown("brief-form") },
    { id: "o-modes", phase: "office", target: "#brief-form .modes", next: true, interactive: true, skip: () => !isShown("brief-form") },
    { id: "o-start", phase: "office", target: "#start", next: true, skip: () => !isShown("brief-form") },
    { id: "o-dash-go", phase: "office", target: navSel("dashboard"), done: () => viewOpen("dashboard") },
    { id: "o-dash", phase: "office", target: "#dashboard", next: true, lost: () => !viewOpen("dashboard"), fallback: "o-dash-go" },
    { id: "o-games-go", phase: "office", target: navSel("games"), done: () => viewOpen("games-view") },
    { id: "o-games", phase: "office", target: "#games-view", next: true, lost: () => !viewOpen("games-view"), fallback: "o-games-go" },
    { id: "o-credits-go", phase: "office", target: navSel("credits"), done: () => viewOpen("credits-view") },
    { id: "o-credits", phase: "office", target: "#credits-view", next: true, lost: () => !viewOpen("credits-view"), fallback: "o-credits-go" },
    { id: "o-studio", phase: "office", target: navSel("studio"), next: true },
    { id: "o-office-go", phase: "office", target: navSel("office"), done: () => !document.body.classList.contains("panel-open") },
    { id: "o-done", phase: "office", next: true, nextLabel: "Let's build", last: true, title: "Your studio is open" }
  ]
});
$("tour-btn").addEventListener("click", () => { setView("office"); tour.start("o-hello"); });

boot();
