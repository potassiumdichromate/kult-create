// The public play page's game frame. A published game's code comes from Creator
// Studio and was written by an AI agent, so it must never run on this origin,
// where the office keeps its sessions: game.html is served with a CSP sandbox
// (see app.js) and loaded in a sandboxed iframe, which gives it an opaque origin.
// The harness matches Creator Studio's own player, so games behave the same here.

export const GAME_ID = /^[A-Za-z0-9_-]{1,64}$/;

// What the play page shows. Never the code or the build's internals.
export const publicGameInfo = (game) => ({
  id: game.id,
  title: game.title || "Untitled game",
  description: game.description || "",
  // Older games carry their template's controls, which can be wrong for the game
  // ("jump" on a penalty shootout). Every game explains itself on its start screen.
  controls: (game.generation?.mode === "compute-layer" && game.gameplay?.controls) || "",
  studio: game.studio?.name || null
});

// Only absolute URLs can load from the sandbox: relative paths and bare
// specifiers can't resolve, and a surviving import would stop the whole game.
const unresolvable = (specifier) => !/^(?:https?:)?\/\//.test(specifier);
const dropIfUnresolvable = (match, specifier) => (unresolvable(specifier) ? "" : match);

function prepareModule(code) {
  return code
    .replace(/^[ \t]*import\s*(?:[\w$*,{}\s]*?\bfrom\s*)?["']([^"']+)["'][ \t]*;?/gm, dropIfUnresolvable)
    .replace(/^[ \t]*export\s*(?:\*(?:\s+as\s+[\w$]+)?|\{[\w$,\s]*\})\s*from\s*["']([^"']+)["'][ \t]*;?/gm, dropIfUnresolvable)
    .replace(/^[ \t]*export\s+default\s+/gm, "")
    .replace(/^[ \t]*export\s*\{[^}]*\}[ \t]*;?[ \t]*$/gm, "")
    .replace(/^([ \t]*)export\s+(const|let|var|function|class|async)/gm, "$1$2");
}

// Runs before the game, as its own script: a syntax error in the game can't stop
// these handlers from being installed.
const HARNESS = String.raw`
// Leaderboard score bridge, as Creator Studio's player has it: games call
// window.reportScore(score) when a run ends, and the page around the game
// (Kult World's Game Hub) submits it. Games that predate the API are read
// off their HUD: the best "Score: N" drawn, sent when game-over text shows.
(function () {
  var best = 0, explicit = false, lastSentAt = 0;
  function send(score) {
    var value = Math.max(0, Math.floor(Number(score) || 0));
    try { window.parent.postMessage({ __kultGameScore: value }, "*"); } catch (e) {}
  }
  window.reportScore = function (score) { explicit = true; send(score); };
  var scoreRe = /(?:score|pts|points)\s*[:\-]?\s*([0-9][0-9,]*)/i;
  var overRe = /game\s*over|you\s*win|you\s*lose|you\s*died|crashed|squashed|board\s*cleared|out\s*of\s*moves|quiz\s*complete|wins|you\s*fell|press\s*r|tap\s*to\s*restart|play\s*again/i;
  function scan(text) {
    var s = String(text);
    var over = overRe.test(s);
    if (over) window.__kultGameOver = true;
    if (explicit) return;
    var m = s.match(scoreRe);
    if (m) { var v = parseInt(m[1].replace(/,/g, ""), 10); if (isFinite(v)) best = Math.max(best, v); }
    if (over && Date.now() - lastSentAt > 5000) { lastSentAt = Date.now(); send(best); }
  }
  var fill = CanvasRenderingContext2D.prototype.fillText;
  var stroke = CanvasRenderingContext2D.prototype.strokeText;
  // Generated games often flip the canvas (ctx.scale(-1, 1)) to face a sprite
  // left and then draw their title or HUD before undoing it, so the text comes
  // out mirrored. Text is never meant to read backwards: draw it unflipped,
  // over the same stretch of screen (left and right alignment swap).
  var SWAP = { left: "right", right: "left", start: "end", end: "start" };
  function draw(ctx, fn, text, x, y, maxWidth) {
    var m = ctx.getTransform ? ctx.getTransform() : null;
    if (!m || !(m.a < 0) || Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6) {
      return maxWidth === undefined ? fn.call(ctx, text, x, y) : fn.call(ctx, text, x, y, maxWidth);
    }
    ctx.save();
    ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0);
    if (SWAP[ctx.textAlign]) ctx.textAlign = SWAP[ctx.textAlign];
    try { return maxWidth === undefined ? fn.call(ctx, text, x, y) : fn.call(ctx, text, x, y, maxWidth); }
    finally { ctx.restore(); }
  }
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
    scan(text);
    return draw(this, fill, text, x, y, maxWidth);
  };
  CanvasRenderingContext2D.prototype.strokeText = function (text, x, y, maxWidth) {
    return draw(this, stroke, text, x, y, maxWidth);
  };
})();

function paintFailure(message) {
  var c = document.querySelector("#game");
  var ctx = c && c.getContext("2d");
  if (!ctx) return;
  if (!window.__kultGameParsed) { c.width = 960; c.height = 540; }
  var w = c.width, h = c.height;
  ctx.fillStyle = "#0b0717"; ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ff6b7d"; ctx.font = "bold 20px system-ui, sans-serif";
  ctx.fillText("This game failed to run", w / 2, h / 2 - 16);
  ctx.fillStyle = "#b3a9da"; ctx.font = "15px system-ui, sans-serif";
  ctx.fillText(String(message).slice(0, 90), w / 2, h / 2 + 14);
}
window.addEventListener("error", function (e) {
  paintFailure(e.message || (e.error && e.error.message) || "Unknown error");
});
setTimeout(function () {
  if (!window.__kultGameParsed) paintFailure("The game's code has a syntax error and could not start");
}, 4000);

// The sandbox makes any use of localStorage throw, and games keep high scores
// there. Give them in-memory storage for as long as the frame lives.
(function () {
  function memoryStorage() {
    var data = new Map();
    var api = {
      getItem: function (k) { return data.has(String(k)) ? data.get(String(k)) : null; },
      setItem: function (k, v) { data.set(String(k), String(v)); },
      removeItem: function (k) { data.delete(String(k)); },
      clear: function () { data.clear(); },
      key: function (i) { var keys = Array.from(data.keys()); return i in keys ? keys[i] : null; },
      get length() { return data.size; }
    };
    return new Proxy(api, {
      get: function (t, p) { return p in t ? t[p] : (typeof p === "string" && data.has(p) ? data.get(p) : undefined); },
      set: function (t, p, v) { data.set(String(p), String(v)); return true; },
      deleteProperty: function (t, p) { data.delete(String(p)); return true; },
      has: function (t, p) { return p in t || data.has(String(p)); }
    });
  }
  ["localStorage", "sessionStorage"].forEach(function (name) {
    try { window[name].getItem("__kult_probe__"); return; } catch (e) {}
    try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch (e) {}
  });
})();

// Every game keeps its own aspect ratio, as large as the frame allows.
(function () {
  var c = document.querySelector("#game");
  function fit() {
    if (!c || !c.width || !c.height || !innerWidth || !innerHeight) return;
    var s = Math.min(innerWidth / c.width, innerHeight / c.height);
    c.style.width = Math.round(c.width * s) + "px";
    c.style.height = Math.round(c.height * s) + "px";
  }
  try { new MutationObserver(fit).observe(c, { attributes: true, attributeFilter: ["width", "height"] }); } catch (e) {}
  addEventListener("resize", fit);
  setInterval(fit, 1000);
  fit();
})();

// Noticing "game over" text lets a tap or click restart a keyboard-only game.
(function () {
  var over = /game\s*over|you\s*win|you\s*lose|you\s*died|crashed|squashed|board\s*cleared|out\s*of\s*moves|quiz\s*complete|wins|you\s*fell|press\s*r|tap\s*to\s*restart|play\s*again/i;
  ["fillText", "strokeText"].forEach(function (name) {
    var original = CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name] = function (text) {
      if (over.test(String(text))) window.__kultGameOver = true;
      return original.apply(this, arguments);
    };
  });
})();

// Phones have no keyboard: swipe becomes the arrow keys and tap becomes Space, so
// keyboard-only games still work.
(function () {
  var canvas = document.querySelector("#game");
  var KEYS = {
    up: ["ArrowUp", "ArrowUp", 38], down: ["ArrowDown", "ArrowDown", 40],
    left: ["ArrowLeft", "ArrowLeft", 37], right: ["ArrowRight", "ArrowRight", 39],
    space: [" ", "Space", 32], enter: ["Enter", "Enter", 13], r: ["r", "KeyR", 82]
  };
  function fire(type, key) {
    [window, document, canvas].forEach(function (target) {
      if (!target) return;
      var e = new KeyboardEvent(type, { key: key[0], code: key[1], bubbles: true, cancelable: true });
      try { Object.defineProperty(e, "keyCode", { get: function () { return key[2]; } }); } catch (err) {}
      try { Object.defineProperty(e, "which", { get: function () { return key[2]; } }); } catch (err) {}
      target.dispatchEvent(e);
    });
  }
  function press(name) {
    fire("keydown", KEYS[name]);
    setTimeout(function () { fire("keyup", KEYS[name]); }, 90);
  }
  function restart() { press("r"); press("enter"); press("space"); window.__kultGameOver = false; }
  var sx = 0, sy = 0;
  var opts = { passive: true, capture: true };
  window.addEventListener("touchstart", function (e) {
    var t = e.touches[0];
    if (t) { sx = t.clientX; sy = t.clientY; }
  }, opts);
  window.addEventListener("touchend", function (e) {
    var t = e.changedTouches[0];
    if (!t) return;
    var dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) {
      if (window.__kultGameOver) restart(); else press("space");
    } else if (Math.abs(dx) > Math.abs(dy)) press(dx > 0 ? "right" : "left");
    else press(dy > 0 ? "down" : "up");
  }, opts);
  window.addEventListener("mouseup", function () { if (window.__kultGameOver) restart(); });
})();
`;

const escapeHtml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

export function buildPlayHtml(game) {
  // The refinement payload holds the code itself: don't ship it twice.
  const { refinement, ...gamePackage } = game;
  const json = JSON.stringify(gamePackage).replace(/</g, "\\u003c");
  const body = `const gamePackage = ${json};
window.__kultGameParsed = true;
${prepareModule(refinement.generatedCode)}`.replace(/<\/script>/gi, "<\\/script>");
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${escapeHtml(game.title || "Game")}</title>
<style>
html,body{margin:0;height:100%;background:#0b0717}
body{display:flex;align-items:center;justify-content:center;overflow:hidden;overscroll-behavior:none}
#game{display:block;touch-action:none;user-select:none;-webkit-user-select:none}
</style>
</head><body><canvas id="game"></canvas>
<script>${HARNESS}</script>
<script type="module">
${body}
</script>
</body></html>`;
}
