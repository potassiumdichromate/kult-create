// The guided tutorial, the same as Kult World's: Nova, the KULT guide, walks a
// new player through the building one step at a time. A step spotlights one
// thing on screen (the rest is dimmed and blocked) and either waits for the
// player to do it or explains it with a Next button.
//
// Shared by Kult Create and Kult Sports (public/office/js/tour.js and
// public/js/tour.js): keep the two copies in sync. Each app passes its own
// steps and lines.
//
// Step fields: id (its line is lines[id]), phase (steps are counted per phase),
// title, target (a selector, several joined, or a function returning a rect),
// next (explained with a Next button; the target can't be clicked unless
// interactive), nextLabel, done (waits for the player to do it), doneDelay,
// quiet (hides the tour while something loads), lost + fallback (the player
// closed what the step shows: go back), skip, enter, leave, round, pad,
// guideBottom, last.

const ARROW = '<svg viewBox="0 0 48 60" aria-hidden="true"><path d="M17 2h14v30h13L24 58 4 32h13z" /></svg>';

/**
 * opts: { steps, lines, guide: { img, name }, doneKeys(): string[], onFinish?() }
 */
export function createTour(opts) {
  const { steps, lines } = opts;
  const mk = (tag, cls, attrs = {}) => { const n = document.createElement(tag); if (cls) n.className = cls; Object.assign(n, attrs); return n; };
  // The dimmed screen is four plain panels around the spotlight (a huge
  // box-shadow over a live 3D scene made Chrome flicker); the cover blocks the
  // spotlight itself on steps that only explain it.
  const hole = mk("div", "tour-hole");
  const shades = ["t", "l", "r", "b"].map((s) => { const n = mk("div", `tour-shade ${s}`); n.addEventListener("click", nudge); return n; });
  const cover = mk("div", "tour-cover"); cover.addEventListener("click", nudge);
  const arrow = mk("div", "tour-arrow"); arrow.innerHTML = ARROW;
  const text = mk("p", "tour-text"); text.addEventListener("click", () => finishTyping());
  const count = mk("span", "tour-count");
  const title = mk("b");
  const next = mk("button", "btn primary small tour-next", { type: "button" }); next.addEventListener("click", () => advance());
  const skip = mk("button", "tour-skip", { type: "button", textContent: "Skip tutorial" }); skip.addEventListener("click", () => stop(true));
  const face = mk("div", "tour-face");
  face.append(mk("img", "", { src: opts.guide.img, alt: "" }), mk("span", "tour-name", { textContent: opts.guide.name }));
  const top = mk("div", "tour-top"); top.append(title, count);
  const btns = mk("div", "tour-btns"); btns.append(skip, next);
  const say = mk("div", "tour-say"); say.append(top, text, btns);
  const guide = mk("div", "tour-guide panel"); guide.append(face, say);
  const root = mk("div", "tour", { id: "tour", hidden: true });
  root.append(...shades, cover, hole, arrow, guide);
  document.body.append(root);

  let i = -1, step = null, enteredAt = 0, doneAt = 0, raf = 0, typing = null, full = "", scrolled = false, lastR = null;

  function start(fromId = steps[0].id) {
    i = Math.max(0, steps.findIndex((s) => s.id === fromId));
    root.hidden = false;
    if (!raf) raf = requestAnimationFrame(frame);
    enter();
  }
  function stop(skipped = false) {
    if (!step) return;
    step.leave?.();
    step = null; i = -1; root.hidden = true;
    cancelAnimationFrame(raf); raf = 0; clearInterval(typing);
    for (const k of opts.doneKeys()) { try { localStorage.setItem(k, skipped ? "skipped" : "done"); } catch { /* storage optional */ } }
    if (!skipped) opts.onFinish?.();
  }
  function enter() {
    step = steps[i];
    if (step.skip?.()) return advance();
    enteredAt = performance.now(); doneAt = 0; scrolled = false; lastR = null;
    root.className = `tour${step.target ? "" : " center"}`;
    title.textContent = step.title || "Nova, your guide";
    const phase = steps.filter((s) => s.phase === step.phase);
    count.textContent = `${phase.indexOf(step) + 1} / ${phase.length}`;
    next.hidden = !step.next; next.textContent = step.nextLabel || "Next";
    skip.hidden = Boolean(step.last);
    guide.classList.remove("in"); void guide.offsetWidth; guide.classList.add("in");
    step.enter?.();
    type(lines[step.id] || "");
  }
  function advance() {
    if (!step) return;
    step.leave?.();
    if (step.last || i + 1 >= steps.length) return stop(false);
    i++; enter();
  }
  function goto(id) { step?.leave?.(); i = steps.findIndex((s) => s.id === id); enter(); }

  // Nova's lines type themselves out; a click shows the rest at once.
  function type(s) {
    clearInterval(typing); full = s;
    let n = 0;
    text.textContent = "";
    typing = setInterval(() => { n += 2; text.textContent = full.slice(0, n); if (n >= full.length) clearInterval(typing); }, 18);
  }
  function finishTyping() { clearInterval(typing); text.textContent = full; }
  // A click on the dimmed part: the arrow jumps to say "here".
  function nudge() { arrow.classList.remove("nudge"); void arrow.offsetWidth; arrow.classList.add("nudge"); }

  function rectOf(target) {
    const r = typeof target === "function" ? target() : unionRect(target);
    if (!r || r.width < 2 || r.height < 2) return null;
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return null;
    return r;
  }
  function unionRect(sel) {
    const rs = [...document.querySelectorAll(sel)].map((n) => n.getBoundingClientRect()).filter((r) => r.width && r.height);
    if (!rs.length) return null;
    const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
    const right = Math.max(...rs.map((r) => r.right)), bottom = Math.max(...rs.map((r) => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!step) return;
    const s = step;
    if (s.lost?.() && now - enteredAt > 600) return goto(s.fallback);
    if (s.done && now - enteredAt > 400 && s.done()) {
      doneAt ||= now;
      if (now - doneAt >= (s.doneDelay ?? 250)) return advance();
    }
    const quiet = Boolean(s.quiet?.());
    setClass(root, "quiet", quiet);
    if (quiet) return;
    // A target below the fold (a phone's form) scrolls into view once.
    if (typeof s.target === "string" && !scrolled) {
      const n = document.querySelector(s.target), b = n?.getBoundingClientRect();
      if (b?.height && (b.top < 60 || b.bottom > innerHeight - 20)) { n.scrollIntoView({ block: "center", behavior: "smooth" }); scrolled = true; }
    }
    let r = s.target ? rectOf(s.target) : null;
    if (r && lastR && ["left", "top", "width", "height"].every((k) => Math.abs(r[k] - lastR[k]) <= 2)) r = lastR;
    lastR = r;
    layout(r, s);
  }

  function layout(r, s) {
    const W = innerWidth, H = innerHeight;
    const pad = s.pad ?? 8;
    if (r) {
      const x = Math.round(r.left - pad), y = Math.round(r.top - pad), w = Math.round(r.width + pad * 2), h = Math.round(r.height + pad * 2);
      place(hole, x, y, w, h); set(hole, "hidden", false); setClass(hole, "round", Boolean(s.round));
      place(shades[0], 0, 0, W, y); place(shades[1], 0, y, x, h); place(shades[2], x + w, y, W - x - w, h); place(shades[3], 0, y + h, W, H - y - h);
      for (const n of shades) set(n, "hidden", false);
      const passive = s.next && !s.interactive;
      if (passive) place(cover, x, y, w, h);
      set(cover, "hidden", !passive);
      // The arrow points at it from the roomier side; at a tall target, from beside it.
      let ax, ay, dir;
      if (h > H * 0.55) {
        const fromRight = x + w + 64 < W;
        ax = fromRight ? x + w + 4 : x - 52; ay = y + h / 2 - 30; dir = fromRight ? "left" : "right";
      } else {
        const below = r.top + r.height / 2 < H * 0.45;
        ax = Math.min(W - 40, Math.max(16, r.left + r.width / 2 - 24)); ay = below ? y + h + 6 : y - 66; dir = below ? "up" : "down";
      }
      place(arrow, Math.round(ax), Math.round(ay));
      if (arrow.dataset.dir !== dir) arrow.dataset.dir = dir;
      set(arrow, "hidden", false);
      // Nova sits away from it.
      setClass(guide, "top", r.top + r.height / 2 > H * 0.5 && !s.guideBottom);
      setClass(guide, "right", r.left + r.width / 2 < W * 0.5);
    } else {
      set(hole, "hidden", true); set(arrow, "hidden", true); set(cover, "hidden", true);
      place(shades[0], 0, 0, W, H); set(shades[0], "hidden", false);
      for (const n of shades.slice(1)) set(n, "hidden", true);
      setClass(guide, "top", false); setClass(guide, "right", false);
    }
  }
  // This runs every frame: touch the DOM only when something changed.
  function place(n, x, y, w, h) {
    const key = `${x},${y},${w},${h}`;
    if (n._at === key) return;
    n._at = key;
    n.style.left = `${x}px`; n.style.top = `${y}px`;
    if (w !== undefined) { n.style.width = `${Math.max(0, w)}px`; n.style.height = `${Math.max(0, h)}px`; }
  }
  const set = (n, k, v) => { if (n[k] !== v) n[k] = v; };
  const setClass = (n, c, on) => { if (n.classList.contains(c) !== on) n.classList.toggle(c, on); };

  addEventListener("keydown", (e) => {
    if (!step || root.classList.contains("quiet")) return;
    if (e.key === "Enter" && step.next && !e.target.closest("input, textarea, select")) { e.preventDefault(); advance(); }
    if (e.key === "Escape") stop(true);
  });

  return {
    start,
    stop,
    get running() { return Boolean(step); },
    /** Starts the tour at `fromId` unless this player has finished or skipped it. */
    offer(fromId, force = false) {
      if (step) return;
      let seen = false;
      for (const k of opts.doneKeys()) { try { if (localStorage.getItem(k)) seen = true; } catch { /* storage optional */ } }
      if (!seen || force) start(fromId);
    }
  };
}
