// The CEO dashboard view: studio totals, engagement over time, every game
// with its plays/likes/comments/shares/remixes, recent comments, the team's
// output and the credit ledger. Data comes from GET /agency/dashboard.

const n = (v) => Number(v || 0).toLocaleString();
const duration = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`);
const ago = (t) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return node;
}

const STAT_COLORS = { plays: "#5ec8f2", likes: "#ff7eb6", comments: "#c792ea", shares: "#7ee081", remixes: "#ffd166", earned: "#f2c14e", kp: "#ff9f5a", credits: "#f2c14e" };

const METRICS = {
  plays: { label: "Plays", get: (p) => p.plays, fmt: n, color: "#5ec8f2" },
  games: { label: "Games", get: (p) => p.games, fmt: n, color: "#7ee081" },
  time: { label: "Play time", get: (p) => p.timeSeconds, fmt: duration, color: "#ff7eb6" },
  earned: { label: "Creator Score", get: (p) => p.earned, fmt: n, color: "#f2c14e" }
};

// Bar chart drawn at the canvas's real on-screen size (times the device
// pixel ratio), so text stays sharp at any width. Bars keep the chunky look.
function drawChart(canvas, points, metric) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(280, Math.round(canvas.clientWidth || 600)), H = Math.round(canvas.clientHeight || 220);
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const m = METRICS[metric];
  const values = points.map((p) => Number(m.get(p) || 0));
  const max = Math.max(...values, 0);
  const left = 54, right = 10, top = 22, bottom = 30;
  const plotW = W - left - right, plotH = H - top - bottom;
  const font = (px, weight = 400) => `${weight} ${px}px "Pixelify Sans", ui-sans-serif, sans-serif`;

  // Value axis: 0, half, max (a nice round max so the grid reads well).
  const niceMax = max <= 0 ? 1 : (() => { const p = 10 ** Math.floor(Math.log10(max)); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; })();
  g.font = font(12); g.textBaseline = "middle"; g.textAlign = "right";
  for (const frac of [0, 0.5, 1]) {
    const y = Math.round(top + plotH - frac * plotH) + 0.5;
    g.strokeStyle = frac === 0 ? "#3a2f6e" : "#241a4a"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(left, y); g.lineTo(W - right, y); g.stroke();
    g.fillStyle = "#a49cd0"; g.fillText(m.fmt(niceMax * frac), left - 8, y);
  }

  if (!points.length || max <= 0) {
    g.textAlign = "center"; g.fillStyle = "#a49cd0"; g.font = font(15, 600);
    g.fillText(`No ${m.label.toLowerCase()} in this period yet`, left + plotW / 2, top + plotH / 2);
    drawXLabels(g, points, left, plotW, H, font);
    return;
  }

  const slot = plotW / points.length;
  const bw = Math.max(4, Math.min(48, Math.floor(slot * 0.62)));
  points.forEach((p, i) => {
    const v = values[i];
    const x = Math.round(left + i * slot + (slot - bw) / 2);
    const h = v > 0 ? Math.max(3, Math.round((v / niceMax) * plotH)) : 0;
    const y = top + plotH - h;
    if (h) {
      g.fillStyle = "#000"; g.fillRect(x + 3, y + 3, bw, h);           // pixel drop shadow
      g.fillStyle = m.color; g.fillRect(x, y, bw, h);
      g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(x, y, bw, 3); // highlight
      g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x + bw - 3, y, 3, h); // shade
      g.textAlign = "center"; g.textBaseline = "bottom"; g.fillStyle = "#ece8ff"; g.font = font(12, 600);
      g.fillText(m.fmt(v), x + bw / 2, y - 3);
    }
  });
  drawXLabels(g, points, left, plotW, H, font);
}

function drawXLabels(g, points, left, plotW, H, font) {
  if (!points.length) return;
  const slot = plotW / points.length;
  g.font = font(12); g.fillStyle = "#a49cd0"; g.textAlign = "center"; g.textBaseline = "alphabetic";
  const maxLabels = Math.max(2, Math.floor(plotW / 64));
  const every = Math.ceil(points.length / maxLabels);
  points.forEach((p, i) => { if (i % every === 0) g.fillText(String(p.label || ""), left + i * slot + slot / 2, H - 8); });
}

// Tiny pixel portrait of an employee for the team grid.
function portrait(color, seed) {
  const c = document.createElement("canvas");
  c.width = 12; c.height = 12;
  const g = c.getContext("2d");
  const skins = ["#f5d0a9", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
  const hairs = ["#2b1b17", "#5a3825", "#d6b370", "#a52a2a", "#1c1c3c"];
  g.fillStyle = skins[seed % skins.length]; g.fillRect(3, 2, 6, 5);
  g.fillStyle = hairs[(seed >> 2) % hairs.length]; g.fillRect(3, 1, 6, 2);
  g.fillStyle = "#1a1033"; g.fillRect(4, 4, 1, 1); g.fillRect(7, 4, 1, 1);
  g.fillStyle = color; g.fillRect(2, 7, 8, 5);
  return c;
}

export function renderDashboard(root, data, { onOpenGame, onPublishGame, onLinkOkx, portraitOf }) {
  const t = data.totals;
  const body = [];

  // Totals
  body.push(el("section", { class: "dash-section" },
    el("h3", {}, "Engagement", el("small", {}, data.engagement === "ok" ? "From Kult Creator Studio" : "")),
    el("div", { class: "stats" },
      stat("Plays", n(t.plays), STAT_COLORS.plays),
      stat("Likes", n(t.likes), STAT_COLORS.likes),
      stat("Comments", n(t.comments), STAT_COLORS.comments),
      stat("Shares", n(t.shares), STAT_COLORS.shares),
      stat("Remixes", n(t.remixes), STAT_COLORS.remixes),
      stat("Creator Score", n(t.earned), STAT_COLORS.earned),
      stat("KULT points", n(t.kultPoints), STAT_COLORS.kp))));

  body.push(el("section", { class: "dash-section" },
    el("h3", {}, "Studio"),
    el("div", { class: "stats" },
      stat("Games shipped", n(t.games), "#7ee081"),
      stat("Published", n(t.published), "#5ec8f2"),
      stat("Productions", n(t.productions), "#c792ea"),
      stat("Credits left", n(t.creditsLeft), STAT_COLORS.credits),
      stat("Credits spent", n(t.creditsSpent), "#f78c6b"),
      stat("Refunded", n(t.creditsRefunded), "#7ee081"))));

  // Chart
  const canvas = el("canvas", { id: "dash-chart", "aria-label": "Engagement over time" });
  let metric = "plays";
  const tabs = el("div", { class: "chart-tabs", role: "group", "aria-label": "Chart metric" },
    Object.entries(METRICS).map(([key, m]) => el("button", { type: "button", "aria-pressed": key === metric ? "true" : "false", onclick: (e) => {
      metric = key;
      for (const b of tabs.children) b.setAttribute("aria-pressed", "false");
      e.currentTarget.setAttribute("aria-pressed", "true");
      drawChart(canvas, data.series.points || [], metric);
    } }, m.label)));
  body.push(el("section", { class: "dash-section" }, el("h3", {}, "Over time", el("small", {}, rangeCaption(data.series.range))), el("div", { class: "chart-wrap" }, tabs, canvas)));

  // Games
  const games = data.games || [];
  body.push(el("section", { class: "dash-section", id: "dash-games" },
    el("h3", {}, "Games", el("small", {}, `${games.length} total`)),
    games.length ? el("div", { class: "game-list" }, games.map((g) => gameRow(g, { onOpenGame, onPublishGame })))
      : el("p", { class: "empty-dash" }, "No games yet. Write a brief in the Office to start your first production.")));

  // Recent comments across games
  const comments = games.flatMap((g) => (g.recentComments || []).map((c) => ({ ...c, game: g.title })));
  body.push(el("section", { class: "dash-section" },
    el("h3", {}, "Recent comments"),
    comments.length ? el("div", { class: "comments" }, comments.slice(0, 8).map((c) => el("div", { class: "comment" }, el("b", {}, c.username), ` on ${c.game}: `, c.text)))
      : el("p", { class: "empty-dash" }, "Comments from players will show up here once your games are published.")));

  // Team
  const busiest = Math.max(1, ...data.team.map((m) => m.done));
  body.push(el("section", { class: "dash-section" },
    el("h3", {}, "Your team", el("small", {}, "Tasks completed")),
    el("div", { class: "team-grid" }, data.team.map((m, i) => el("div", { class: "member", style: `--c:${m.color}` },
      portraitOf?.(m.id) || portrait(m.color, i * 7 + m.id.length),
      el("div", {}, el("div", { class: "n" }, m.name || m.title), el("div", { class: "t" }, `${m.title} · ${n(m.done)} done${m.errors ? ` · ${m.errors} issues` : ""}`),
        el("div", { class: "bar" }, el("i", { style: `width:${Math.round((m.done / busiest) * 100)}%` }))))))));

  // OKX nudge for studios not yet on OKX.ai
  if (!data.studio.okxAgentId) {
    body.push(el("section", { class: "dash-section" }, el("div", { class: "notice" },
      "Want commercial work? Link an OKX.ai identity so OKX users and agentic tasks on Onchain OS can discover your studio. ",
      el("button", { type: "button", class: "linkish", onclick: onLinkOkx }, "Link OKX.ai"))));
  }

  root.replaceChildren(...body);
  drawChart(canvas, data.series.points || [], metric);
  chartObserver?.disconnect();
  chartObserver = new ResizeObserver(() => drawChart(canvas, data.series.points || [], metric));
  chartObserver.observe(canvas);
}
let chartObserver = null;

function stat(label, value, color) {
  return el("div", { class: "stat", style: `--c:${color}` }, el("span", { class: "k" }, label), el("span", { class: "v" }, value));
}

function rangeCaption(range) {
  return { day: "Last 24 hours", week: "Last 7 days", month: "Last 30 days", year: "Last 12 months" }[range] || "";
}

function gameRow(g, { onOpenGame, onPublishGame }) {
  const s = g.stats;
  const status = g.published?.status === "published" ? ["Published", "ok"] : g.status === "complete" ? ["Ready", "ok"] : g.status === "running" || g.status === "updating" ? ["In production", "run"] : ["Failed", "bad"];
  return el("div", { class: "game-row" },
    g.coverUrl ? el("img", { class: "thumb", src: g.coverUrl, alt: "", loading: "lazy" }) : el("span", { class: "thumb" }),
    el("div", { style: "min-width:0" },
      el("div", { class: "title" }, g.title, el("span", { class: `tag ${status[1]}` }, status[0])),
      el("div", { class: "meta" }, [g.mode?.toUpperCase(), `${g.versions} version${g.versions === 1 ? "" : "s"}`, g.changes ? `${g.changes} change${g.changes === 1 ? "" : "s"}` : null, `${n(g.creditsSpent)} credits`, ago(g.createdAt)].filter(Boolean).join(" · ")),
      el("div", { class: "pills" },
        pill("plays", s.plays, STAT_COLORS.plays), pill("likes", s.likes, STAT_COLORS.likes), pill("comments", s.comments, STAT_COLORS.comments),
        pill("shares", s.shares, STAT_COLORS.shares), pill("remixes", s.remixes, STAT_COLORS.remixes), pill("score", s.earned, STAT_COLORS.earned))),
    el("div", { class: "acts" },
      g.versions > 0 ? el("button", { type: "button", class: "btn small", onclick: () => onOpenGame(g) }, "Play") : null,
      g.versions > 0 && g.published?.status !== "published" ? el("button", { type: "button", class: "btn small", onclick: () => onPublishGame(g) }, "Publish") : null,
      g.published?.playUrl ? el("a", { class: "btn small ghost", href: g.published.playUrl, target: "_blank", rel: "noopener" }, "Live page") : null));
}

function pill(label, value, color) {
  return el("span", { style: `--c:${color}` }, el("i"), `${n(value)} ${label}`);
}

export function renderTopGames(root, games, { onPlay }) {
  if (!games.length) {
    root.replaceChildren(el("p", { class: "empty-dash" }, "No published games yet. Be the first: make a game in the Office and publish it."));
    return;
  }
  root.replaceChildren(el("div", { class: "top-list" }, games.map((g) => el("div", { class: `top-row${g.mine ? " mine" : ""}` },
    el("span", { class: "rank" }, `#${g.rank}`),
    g.thumbnailUrl ? el("img", { class: "thumb", src: g.thumbnailUrl, alt: "", loading: "lazy" }) : el("span", { class: "thumb" }),
    el("div", { style: "min-width:0" },
      el("div", { class: "title" }, g.title, g.mine ? el("span", { class: "tag ok" }, "Your studio") : null),
      el("div", { class: "meta" }, g.studio?.name ? `by ${g.studio.name}` : "Kult Create studio"),
      el("div", { class: "pills" },
        pill("plays", g.plays, STAT_COLORS.plays), pill("likes", g.likes, STAT_COLORS.likes),
        pill("comments", g.comments, STAT_COLORS.comments), pill("shares", g.shares, STAT_COLORS.shares))),
    el("div", { class: "acts" }, g.playUrl ? el("button", { type: "button", class: "btn small", onclick: () => onPlay(g) }, "Play") : null)))));
}
