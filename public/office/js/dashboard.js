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

// Pixel bar chart on a small canvas, scaled up crisply by CSS.
function drawChart(canvas, points, metric) {
  const W = 320, H = 90;
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#0e0a20"; g.fillRect(0, 0, W, H);
  const m = METRICS[metric];
  const values = points.map(m.get);
  const max = Math.max(1, ...values);
  g.fillStyle = "#1e1640";
  for (let y = 10; y < H - 12; y += 10) g.fillRect(0, y, W, 1);
  if (!points.length) {
    g.fillStyle = "#6b62a0"; g.font = "8px 'Press Start 2P', monospace"; g.fillText("NO DATA YET", W / 2 - 40, H / 2);
    return;
  }
  const slot = W / points.length, bw = Math.max(2, Math.floor(slot * 0.6));
  points.forEach((p, i) => {
    const h = Math.round((values[i] / max) * (H - 24));
    const x = Math.round(i * slot + (slot - bw) / 2);
    g.fillStyle = m.color; g.fillRect(x, H - 12 - h, bw, h);
    g.fillStyle = "rgba(255,255,255,0.35)"; if (h > 1) g.fillRect(x, H - 12 - h, bw, 1);
  });
  // A handful of x labels so they never overlap.
  g.fillStyle = "#a49cd0"; g.font = "6px 'Press Start 2P', monospace";
  const every = Math.ceil(points.length / 6);
  points.forEach((p, i) => { if (i % every === 0) g.fillText(String(p.label || "").slice(0, 6), Math.round(i * slot), H - 2); });
  g.fillStyle = "#e8e8f0"; g.fillText(`MAX ${m.fmt(max)}`, 2, 8);
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

export function renderDashboard(root, data, { onOpenGame, onPublishGame, onLinkOkx }) {
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
      portrait(m.color, i * 7 + m.id.length),
      el("div", {}, el("div", { class: "n" }, m.name || m.title), el("div", { class: "t" }, `${m.title} · ${n(m.done)} done${m.errors ? ` · ${m.errors} issues` : ""}`),
        el("div", { class: "bar" }, el("i", { style: `width:${Math.round((m.done / busiest) * 100)}%` }))))))));

  // Credits
  body.push(el("section", { class: "dash-section", id: "dash-credits" },
    el("h3", {}, "Credits", el("small", {}, `${n(t.creditsLeft)} left`)),
    data.ledger.length ? el("table", { class: "ledger" },
      el("thead", {}, el("tr", {}, el("th", {}, "When"), el("th", {}, "What"), el("th", { class: "amt" }, "Credits"))),
      el("tbody", {}, data.ledger.map((e) => el("tr", {},
        el("td", { class: "muted" }, ago(e.at)),
        el("td", {}, e.reason === "refund" ? "Refund (build failed)" : e.reason),
        el("td", { class: `amt ${e.delta < 0 ? "neg" : "pos"}` }, `${e.delta > 0 ? "+" : ""}${n(e.delta)}`)))))
      : el("p", { class: "empty-dash" }, "No credit activity yet.")));

  // OKX nudge for studios not yet on OKX.ai
  if (!data.studio.okxAgentId) {
    body.push(el("section", { class: "dash-section" }, el("div", { class: "notice" },
      "Want commercial work? Link an OKX.ai identity so OKX users and agentic tasks on Onchain OS can discover your studio. ",
      el("button", { type: "button", class: "linkish", onclick: onLinkOkx }, "Link OKX.ai"))));
  }

  root.replaceChildren(...body);
  drawChart(canvas, data.series.points || [], metric);
}

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
