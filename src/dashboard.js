import { EMPLOYEES } from "./employees.js";

// The CEO dashboard: what the studio made and spent (this service) joined
// with how its published games are doing (Creator Studio: plays, likes,
// comments, shares, remixes, Creator Score, KULT points).

const EMPTY_STATS = { plays: 0, likes: 0, comments: 0, shares: 0, remixes: 0, earned: 0, kpEarned: 0 };

export async function buildDashboard({ store, studio, agency, range }) {
  const [productions, ledger] = await Promise.all([
    store.find("productions", { agencyId: agency.id }, { sort: { createdAt: -1 }, limit: 200 }),
    store.find("ledger", { agencyId: agency.id }, { sort: { at: -1 }, limit: 200 })
  ]);

  // Engagement lives in Creator Studio; the dashboard still works without it.
  let engagement = null, engagementError = null;
  try {
    engagement = await studio.dashboard({ agencyId: agency.id, wallets: agency.ownerWallets, range });
  } catch (error) {
    engagementError = error.message;
  }
  const statsByGame = new Map((engagement?.games ?? []).map((g) => [g.id, g]));

  // One row per game: a build plus every change request made on it.
  const byId = new Map(productions.map((p) => [p.id, p]));
  const rootOf = (p) => { let r = p; while (r.parentId && byId.has(r.parentId)) r = byId.get(r.parentId); return r; };
  const rows = new Map();
  for (const p of [...productions].reverse()) { // oldest first, so the latest version wins
    const root = rootOf(p);
    const row = rows.get(root.id) ?? {
      id: root.id, brief: root.brief, mode: root.mode, createdAt: root.createdAt,
      title: null, coverUrl: null, playUrl: null, status: root.status, versions: 0, changes: 0,
      creditsSpent: 0, published: null, latestId: root.id, error: null
    };
    row.versions += p.status === "complete" ? 1 : 0;
    if (p.kind === "edit") row.changes += 1;
    row.creditsSpent += p.status === "failed" ? 0 : p.cost;
    if (p.status === "complete" && p.result) {
      row.title = p.result.title || row.title;
      row.coverUrl = p.result.coverUrl || row.coverUrl;
      row.playUrl = p.result.playUrl || row.playUrl;
      row.latestId = p.id;
      row.status = "complete";
    } else if (p.status === "running") row.status = row.status === "complete" ? "updating" : "running";
    else if (p.status === "failed" && row.status !== "complete") { row.status = "failed"; row.error = p.error ?? null; }
    if (p.published) row.published = p.published;
    rows.set(root.id, row);
  }
  const games = [...rows.values()].map((row) => {
    const live = row.published?.gameId ? statsByGame.get(row.published.gameId) : null;
    return {
      ...row,
      title: row.title || live?.title || row.brief.slice(0, 48),
      coverUrl: row.coverUrl || live?.thumbnailUrl || null,
      stats: live ? { plays: live.plays, likes: live.likes, comments: live.comments, shares: live.shares, remixes: live.remixes, earned: live.earned, kpEarned: live.kpEarned } : { ...EMPTY_STATS },
      recentComments: live?.recentComments ?? []
    };
  }).sort((a, b) => b.stats.plays - a.stats.plays || b.createdAt - a.createdAt);

  // The team: finished and failed steps per employee, from the timelines.
  const team = new Map(EMPLOYEES.map((e) => [e.id, { id: e.id, title: e.title, name: e.name, color: e.color, done: 0, errors: 0 }]));
  for (const p of productions) {
    for (const e of p.timeline ?? []) {
      if (e.type !== "employee" || !team.has(e.employee)) continue;
      if (e.state === "done") team.get(e.employee).done += 1;
      else if (e.state === "error") team.get(e.employee).errors += 1;
    }
  }

  const spent = ledger.filter((e) => e.delta < 0).reduce((s, e) => s - e.delta, 0);
  const refunded = ledger.filter((e) => e.reason === "refund").reduce((s, e) => s + e.delta, 0);
  const t = engagement?.totals ?? {};
  return {
    studio: {
      name: agency.name, tagline: agency.tagline, createdAt: agency.createdAt, credits: agency.credits,
      ceo: agency.ceo, okxAgentId: agency.okxAgentId ?? null, okx: agency.okx ?? null
    },
    totals: {
      plays: t.plays ?? 0, likes: t.likes ?? 0, comments: t.comments ?? 0, shares: t.shares ?? 0, remixes: t.remixes ?? 0,
      earned: t.earned ?? 0, kultPoints: t.kultPoints ?? 0,
      games: games.filter((g) => g.versions > 0).length,
      published: games.filter((g) => g.published?.status === "published").length,
      productions: productions.length,
      creditsLeft: agency.credits, creditsSpent: spent - refunded, creditsRefunded: refunded
    },
    series: engagement?.series ?? { range, points: [] },
    games,
    team: [...team.values()].filter((m) => m.id !== "ceo"),
    ledger: ledger.slice(0, 50),
    engagement: engagement ? "ok" : "unavailable",
    engagementError
  };
}
