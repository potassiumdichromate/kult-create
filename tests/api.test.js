import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import { createStore } from "../src/store/index.js";
import { Productions } from "../src/productions.js";
import { createApp } from "../src/app.js";
import { ownerOf, doneLine, startLine } from "../src/employees.js";

// The whole API in-process, with the chain and the compute layer faked.

const dir = mkdtempSync(join(tmpdir(), "kult-create-"));
const owner = Wallet.createRandom();
const stranger = Wallet.createRandom();

const fakeChain = {
  async okxIdentity(id) {
    if (id === "404") throw Object.assign(new Error("does not exist"), { status: 404 });
    return { agentId: String(id), owner: owner.address.toLowerCase(), agentWallet: null, name: `Agent ${id}`, image: null, description: "" };
  },
  async verifyOkxControl(id, wallets) {
    const info = await this.okxIdentity(id);
    if (!wallets.includes(info.owner)) throw Object.assign(new Error("not yours"), { status: 403, ownerWallet: info.owner });
    return { ...info, verified: true };
  },
  async ceoCandidates() { return [{ tokenId: "7", name: "Nova", image: null }]; },
  async verifyCeo(tokenId, wallets, name) { return { tokenId: String(tokenId), name: name || "Nova", image: null, verified: true }; }
};

// A compute layer that finishes a run after a few polls (or fails it).
class FakeCompute {
  constructor() { this.runs = new Map(); this.n = 0; this.failNextStart = false; }
  async build({ prompt, tier }) {
    if (this.failNextStart) { this.failNextStart = false; throw Object.assign(new Error("compute down"), { status: 502 }); }
    const id = `run_${++this.n}`;
    this.runs.set(id, { id, prompt, tier, polls: 0, fail: /FAIL/.test(prompt) });
    return { id, status: "queued", nodes: [] };
  }
  async edit({ parentRunId, request }) {
    const id = `run_${++this.n}`;
    this.runs.set(id, { id, prompt: request, parentRunId, polls: 0, edit: true });
    return { id, status: "queued", nodes: [] };
  }
  async run(id, outputs) {
    const r = this.runs.get(id);
    if (!outputs) r.polls += 1;
    const p = r.polls;
    const st = (n) => (p > n + 1 ? "done" : p > n ? "running" : "pending");
    const nodes = [
      { id: "brief", status: st(0) },
      { id: "design", status: st(1) },
      { id: "sprite:coin", status: st(1) },
      { id: "code", status: r.fail && p > 3 ? "failed" : st(2), error: r.fail ? "boom" : null, progress: p === 3 ? { chars: 1200 } : null }
    ].map((n) => (outputs ? { ...n, output: n.id === "brief" ? { genre: "arcade", style: "neon", title: "Test" } : n.id === "sprite:coin" ? { url: "https://x/coin.png" } : {} } : n));
    const status = r.fail && p > 3 ? "failed" : p > 4 ? "complete" : "running";
    return { id, status, nodes, error: status === "failed" ? "code failed" : null, result: status === "complete" ? { title: "Test Game", playUrl: `https://compute/play/${id}`, gameId: "g1", quality: { acceptance: { ok: true } } } : null };
  }
  async health() { return { ok: true }; }
}

let server, base, store, productions;
const compute = new FakeCompute();
const studioCalls = [];
const fakeStudio = { async importRun(args) { studioCalls.push(args); return { gameId: "g1", playUrl: "https://studio/play?gameId=g1", status: args.publish ? "published" : "draft" }; } };

before(async () => {
  store = await createStore({ mongoUri: "", dataFile: join(dir, "db.json") });
  productions = new Productions({ store, compute, pollMs: 15 });
  const app = createApp({ store, productions, chain: fakeChain, studio: fakeStudio, compute });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { productions.stopAll(); server.close(); await store.close(); rmSync(dir, { recursive: true, force: true }); });

async function call(method, path, body, token) {
  const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function signIn(wallet, purpose = "sign-in", token) {
  const ch = await call("POST", "/auth/challenge", { address: wallet.address, purpose });
  const signature = await wallet.signMessage(ch.body.message);
  return call("POST", purpose === "link" ? "/auth/link" : "/auth/verify", { nonce: ch.body.nonce, signature }, token);
}
const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 20)); }
};

let token;

test("sign-in rejects a signature from another wallet and replays", async () => {
  const ch = await call("POST", "/auth/challenge", { address: owner.address });
  const bad = await call("POST", "/auth/verify", { nonce: ch.body.nonce, signature: await stranger.signMessage(ch.body.message) });
  assert.equal(bad.status, 401);
  const ch2 = await call("POST", "/auth/challenge", { address: owner.address });
  const sig = await owner.signMessage(ch2.body.message);
  const ok = await call("POST", "/auth/verify", { nonce: ch2.body.nonce, signature: sig });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.hasAgency, false);
  const replay = await call("POST", "/auth/verify", { nonce: ch2.body.nonce, signature: sig });
  assert.equal(replay.status, 401);
  token = ok.body.token;
});

test("the office is closed until you register a studio", async () => {
  const r = await call("GET", "/agency", null, token);
  assert.equal(r.status, 404);
  assert.equal(r.body.code, "NO_AGENCY");
  assert.equal((await call("GET", "/agency")).status, 401);
});

test("a stranger cannot register someone else's OKX identity", async () => {
  const s = await signIn(stranger);
  const r = await call("POST", "/agency", { name: "Thieves", okxAgentId: "99", ceoTokenId: "8" }, s.body.token);
  assert.equal(r.status, 403);
  assert.equal(r.body.ownerWallet, owner.address.toLowerCase());
});

test("registering grants 1000 credits; one studio per identity", async () => {
  const r = await call("POST", "/agency", { name: "Pixel Pirates", okxAgentId: "2170", ceoTokenId: "7" }, token);
  assert.equal(r.status, 201);
  assert.equal(r.body.agency.credits, 1000);
  assert.equal(r.body.agency.ceo.name, "Nova");
  const again = await call("POST", "/agency", { name: "Again", okxAgentId: "2170", ceoTokenId: "7" }, token);
  assert.equal(again.status, 409);
  const ledger = await call("GET", "/ledger", null, token);
  assert.equal(ledger.body.entries[0].delta, 1000);
});

test("a Pro production costs 40, streams employee events and completes", async () => {
  const r = await call("POST", "/agency/productions", { brief: "A neon space shooter with asteroids", mode: "pro" }, token);
  assert.equal(r.status, 202);
  assert.equal(r.body.credits, 960);
  const id = r.body.production.id;
  assert.equal(compute.runs.get("run_1").tier, 2);
  // A second production while one is running is refused and not charged.
  const busy = await call("POST", "/agency/productions", { brief: "Another game please", mode: "pro" }, token);
  assert.equal(busy.status, 409);
  const done = await waitFor(async () => { const p = (await call("GET", `/agency/productions/${id}`, null, token)).body.production; return p.status === "complete" && p; });
  assert.equal(done.result.title, "Test Game");
  const lines = done.timeline.filter((e) => e.type === "employee");
  assert.ok(lines.some((e) => e.employee === "producer" && e.state === "working"));
  assert.ok(lines.some((e) => e.employee === "producer" && e.state === "done" && /arcade/.test(e.line)));
  assert.ok(lines.some((e) => e.employee === "illustrator" && e.image === "https://x/coin.png"));
  assert.equal((await call("GET", "/agency", null, token)).body.agency.credits, 960);
  assert.equal((await call("GET", "/agency", null, token)).body.agency.gamesMade, 1);
});

test("SSE replays a finished production's timeline", async () => {
  const list = (await call("GET", "/agency", null, token)).body.productions;
  const res = await fetch(`${base}/agency/productions/${list[0].id}/events?token=${encodeURIComponent(token)}`);
  const text = await res.text();
  const first = JSON.parse(text.split("\n\n")[0].replace(/^data: /, ""));
  assert.equal(first.type, "snapshot");
  assert.equal(first.production.status, "complete");
  assert.ok(first.production.timeline.length > 3);
});

test("Ultra costs 100; a failed run refunds the credits", async () => {
  const r = await call("POST", "/agency/productions", { brief: "This one will FAIL in code", mode: "ultra" }, token);
  assert.equal(r.body.credits, 860);
  const id = r.body.production.id;
  const p = await waitFor(async () => { const x = (await call("GET", `/agency/productions/${id}`, null, token)).body.production; return x.status === "failed" && x; });
  assert.equal(p.refunded, 100);
  assert.equal((await call("GET", "/agency", null, token)).body.agency.credits, 960);
  assert.ok(p.timeline.some((e) => e.state === "error"));
});

test("a compute layer that refuses the run refunds immediately", async () => {
  compute.failNextStart = true;
  const r = await call("POST", "/agency/productions", { brief: "A puzzle game with gems", mode: "ultra" }, token);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /refunded/);
  assert.equal((await call("GET", "/agency", null, token)).body.agency.credits, 960);
});

test("credits never go below zero", async () => {
  const agency = (await call("GET", "/agency", null, token)).body.agency;
  await store.update("agencies", agency.id, { credits: 30 });
  const r = await call("POST", "/agency/productions", { brief: "A neon space shooter with asteroids", mode: "pro" }, token);
  assert.equal(r.status, 402);
  assert.equal((await call("GET", "/agency", null, token)).body.agency.credits, 30);
  await store.update("agencies", agency.id, { credits: 960 });
});

test("edits cost 10 and run against the parent run", async () => {
  const list = (await call("GET", "/agency", null, token)).body.productions;
  const parent = list.find((p) => p.status === "complete");
  const r = await call("POST", `/agency/productions/${parent.id}/edits`, { request: "Make the ship faster" }, token);
  assert.equal(r.status, 202);
  assert.equal(r.body.credits, 950);
  assert.equal(compute.runs.get(`run_${compute.n}`).parentRunId, "run_1");
  await waitFor(async () => (await call("GET", `/agency/productions/${r.body.production.id}`, null, token)).body.production.status === "complete");
});

test("publishing hands the run to creator studio once", async () => {
  const list = (await call("GET", "/agency", null, token)).body.productions;
  const p = list.find((x) => x.status === "complete" && x.kind === "build");
  const r = await call("POST", `/agency/productions/${p.id}/publish`, {}, token);
  assert.equal(r.status, 200);
  assert.equal(r.body.published.status, "published");
  assert.equal(studioCalls[0].runId, "run_1");
  assert.equal(studioCalls[0].creatorWallet, owner.address.toLowerCase());
  assert.equal(studioCalls[0].studio.name, "Pixel Pirates");
  await call("POST", `/agency/productions/${p.id}/publish`, {}, token);
  assert.equal(studioCalls.length, 1);
});

test("other studios cannot see your productions", async () => {
  const s = await signIn(stranger);
  const list = (await call("GET", "/agency", null, token)).body.productions;
  const r = await call("GET", `/agency/productions/${list[0].id}`, null, s.body.token);
  assert.equal(r.status, 404);
});

test("employee mapping covers every pipeline step", () => {
  for (const id of ["brief", "design", "art", "keyart", "approve-style", "sprites", "environment", "cover", "copy", "assets", "code", "qa", "playtest", "package", "edit-plan", "edit-sprites", "code-edit"]) {
    assert.notEqual(startLine(id), "On it…", id);
    assert.ok(ownerOf(id));
  }
  assert.equal(ownerOf("sprite:big_boss"), "illustrator");
  assert.equal(startLine("sprite:big_boss"), "Drawing big boss…");
  assert.match(doneLine({ id: "qa", status: "done" }, { report: { ok: true }, history: [1, 2] }).line, /after 1 fix/);
  assert.match(doneLine({ id: "code", status: "failed", error: "x" }, {}).line, /problem/);
});

test("a studio can open without an OKX identity; the CEO is the player's own agent", async () => {
  const saved = fakeChain.ceoCandidates;
  fakeChain.ceoCandidates = async () => [{ tokenId: "7", name: "Nova" }, { tokenId: "70", name: "Juno" }]; // #7 already runs a studio
  const solo = Wallet.createRandom();
  const s = await signIn(solo);
  const r = await call("POST", "/agency", { name: "Solo Studio", tagline: "Just games" }, s.body.token);
  fakeChain.ceoCandidates = saved;
  assert.equal(r.status, 201);
  assert.equal(r.body.agency.okx, null);
  assert.equal(r.body.agency.okxAgentId, undefined);
  assert.equal(r.body.agency.ceo.tokenId, "70"); // first of the player's agents not already running a studio
  // A second studio without OKX does not collide on the missing identity...
  const other = await signIn(Wallet.createRandom());
  const second = await call("POST", "/agency", { name: "Other Studio", ceoTokenId: "8" }, other.body.token);
  assert.equal(second.status, 201);
  // ...and the same agent cannot run two studios.
  const third = await signIn(Wallet.createRandom());
  const dup = await call("POST", "/agency", { name: "Copycat", ceoTokenId: "70" }, third.body.token);
  assert.equal(dup.status, 409);
});

test("the OKX identity can be linked later, once, by its owner", async () => {
  const s = await signIn(owner);
  const me = (await call("GET", "/agency", null, s.body.token)).body.agency;
  assert.ok(me.okxAgentId); // registered with one earlier
  const again = await call("POST", "/agency/okx", { okxAgentId: "3000" }, s.body.token);
  assert.equal(again.status, 409);

  const solo = await signIn(stranger);
  const reg = await call("POST", "/agency", { name: "Stranger Studio", ceoTokenId: "9" }, solo.body.token);
  assert.equal(reg.status, 201);
  // fakeChain says every OKX identity belongs to `owner`, so the stranger cannot link one.
  const steal = await call("POST", "/agency/okx", { okxAgentId: "3001" }, solo.body.token);
  assert.equal(steal.status, 403);
});

test("no agent, no studio", async () => {
  const saved = fakeChain.ceoCandidates;
  fakeChain.ceoCandidates = async () => [];
  const s = await signIn(Wallet.createRandom());
  const r = await call("POST", "/agency", { name: "Agentless" }, s.body.token);
  fakeChain.ceoCandidates = saved;
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "NO_AGENT");
});

test("the CEO dashboard joins studio data with Creator Studio engagement", async () => {
  fakeStudio.dashboard = async ({ agencyId, wallets, range }) => {
    assert.ok(agencyId.startsWith("agy_"));
    assert.ok(wallets.includes(owner.address.toLowerCase()));
    return {
      totals: { plays: 42, likes: 7, comments: 3, shares: 2, remixes: 1, earned: 120, kultPoints: 55 },
      series: { range, points: [{ label: "Mon", plays: 42, games: 1, timeSeconds: 600 }] },
      games: [{ id: "g1", title: "Test Game", plays: 42, likes: 7, comments: 3, shares: 2, remixes: 1, earned: 120, kpEarned: 55, recentComments: [{ id: "c1", username: "ana", text: "fun!" }] }]
    };
  };
  const s = await signIn(owner);
  const r = await call("GET", "/agency/dashboard?range=month", null, s.body.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.engagement, "ok");
  assert.equal(r.body.totals.plays, 42);
  assert.equal(r.body.series.range, "month");
  const top = r.body.games[0];
  assert.equal(top.published.gameId, "g1");
  assert.equal(top.stats.plays, 42);
  assert.equal(top.recentComments[0].text, "fun!");
  assert.ok(top.changes >= 1); // the change request is folded into its game
  assert.ok(r.body.totals.creditsSpent > 0);
  assert.ok(r.body.team.find((m) => m.id === "producer").done > 0);
  assert.equal(r.body.team.some((m) => m.id === "ceo"), false);

  // Creator Studio down: the dashboard still answers with studio data.
  fakeStudio.dashboard = async () => { throw new Error("Creator Studio is unreachable right now."); };
  const down = await call("GET", "/agency/dashboard", null, s.body.token);
  assert.equal(down.status, 200);
  assert.equal(down.body.engagement, "unavailable");
  assert.equal(down.body.totals.plays, 0);
  assert.ok(down.body.games.length >= 1);
  // Only signed-in studio owners can read it.
  assert.equal((await call("GET", "/agency/dashboard")).status, 401);
});

test("top games across Kult Create are playable in the office", async () => {
  fakeStudio.topGames = async ({ limit }) => {
    assert.equal(limit, 20);
    return { games: [
      { id: "g1", title: "Test Game", plays: 99, likes: 5, comments: 2, shares: 1, remixes: 0, studio: { agencyId: "someone-else", name: "Rivals" }, computeRunId: "run_9", playUrl: null },
      { id: "g2", title: "Ours", plays: 50, likes: 1, comments: 0, shares: 0, remixes: 0, studio: { agencyId: null, name: "Pixel Pirates" }, computeRunId: null, playUrl: "https://studio/play?gameId=g2" }
    ] };
  };
  const s = await signIn(owner);
  const me = (await call("GET", "/agency", null, s.body.token)).body.agency;
  const saved = fakeStudio.topGames;
  fakeStudio.topGames = async (a) => { const out = await saved(a); out.games[1].studio.agencyId = me.id; return out; };
  const r = await call("GET", "/games/top", null, s.body.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.games[0].rank, 1);
  assert.match(r.body.games[0].playUrl, /\/play\/run_9$/);
  assert.equal(r.body.games[0].mine, false);
  assert.equal(r.body.games[1].mine, true);
  assert.equal(r.body.games[1].playUrl, "https://studio/play?gameId=g2");
  assert.equal((await call("GET", "/games/top")).status, 401);
});
