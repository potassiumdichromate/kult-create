import { EventEmitter } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "./config.js";
import { computeLayer as defaultCompute } from "./services.js";
import { ownerOf, startLine, doneLine } from "./employees.js";

// A production is one game build (or edit) run by the studio's staff on the
// compute layer. Credits are debited up front and refunded if the run fails.
// A watcher polls the run, turns each step's status change into an office
// event ("Mako: Drawing cucumber…"), persists the timeline, and fans events
// out to every open office.

const TERMINAL = new Set(["done", "degraded", "skipped", "failed", "blocked"]);
const gameIdFor = () => randomBytes(9).toString("base64url").replace(/[^a-zA-Z0-9]/g, "x").slice(0, 12);

export class Productions {
  constructor({ store, compute = defaultCompute, pollMs = config.pollMs }) {
    this.store = store;
    this.compute = compute;
    this.pollMs = pollMs;
    this.bus = new EventEmitter();
    this.bus.setMaxListeners(200);
    this.watching = new Map();
  }

  subscribe(productionId, fn) {
    this.bus.on(productionId, fn);
    return () => this.bus.off(productionId, fn);
  }

  async emit(production, event) {
    const e = { at: Date.now(), ...event };
    this.bus.emit(production.id, e);
    if (event.type === "employee" || event.type === "status") await this.store.push("productions", production.id, "timeline", e, 300);
  }

  async ledger(agencyId, delta, reason, ref) {
    await this.store.insert("ledger", { id: randomUUID(), agencyId, delta, reason, ref: ref ?? null, at: Date.now() });
  }

  // Debit first so two parallel requests can never overspend; refund on any failure.
  async charge(agency, cost, reason, ref) {
    const after = await this.store.incIf("agencies", agency.id, "credits", -cost, 0);
    if (!after) throw Object.assign(new Error(`Not enough credits: this needs ${cost}, the studio has ${agency.credits}.`), { status: 402 });
    await this.ledger(agency.id, -cost, reason, ref);
    return after.credits;
  }

  async refund(agencyId, cost, ref) {
    const after = await this.store.incIf("agencies", agencyId, "credits", cost, 0);
    await this.ledger(agencyId, cost, "refund", ref);
    return after?.credits;
  }

  async activeFor(agencyId) {
    const list = await this.store.find("productions", { agencyId, status: "running" }, { limit: 1 });
    return list[0] ?? null;
  }

  async create(agency, { brief, mode }) {
    const m = config.modes[mode];
    if (!m) throw Object.assign(new Error("Mode must be pro or ultra"), { status: 400 });
    if (await this.activeFor(agency.id)) throw Object.assign(new Error("Your team is already working on a game. Wait for it to finish."), { status: 409 });
    const cost = config.credits[mode];
    const id = `prd_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const balance = await this.charge(agency, cost, `${m.label} game`, id);
    let run;
    try {
      run = await this.compute.build({ prompt: brief, tier: m.tier, gameId: gameIdFor() });
    } catch (error) {
      await this.refund(agency.id, cost, id);
      throw Object.assign(new Error(`The studio couldn't start the build (${error.message}). Your credits were refunded.`), { status: error.status || 502, expose: true });
    }
    const production = {
      id, agencyId: agency.id, kind: "build", parentId: null, runId: run.id, gameId: run.gameId ?? null,
      mode, tier: m.tier, brief, cost, status: "running", nodes: {}, timeline: [], result: null, published: null,
      createdAt: Date.now(), finishedAt: null
    };
    await this.store.insert("productions", production);
    this.watch(production);
    return { production, balance };
  }

  async edit(agency, parent, { request }) {
    if (parent.status !== "complete") throw Object.assign(new Error("Only a finished game can be changed"), { status: 409 });
    if (await this.activeFor(agency.id)) throw Object.assign(new Error("Your team is already working on a game. Wait for it to finish."), { status: 409 });
    const cost = config.credits.edit;
    const id = `prd_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const balance = await this.charge(agency, cost, "Game change", id);
    let run;
    try {
      run = await this.compute.edit({ parentRunId: parent.runId, request, tier: parent.tier });
    } catch (error) {
      await this.refund(agency.id, cost, id);
      throw Object.assign(new Error(`The studio couldn't start the change (${error.message}). Your credits were refunded.`), { status: error.status || 502, expose: true });
    }
    const production = {
      id, agencyId: agency.id, kind: "edit", parentId: parent.id, runId: run.id, gameId: parent.gameId,
      mode: parent.mode, tier: parent.tier, brief: request, cost, status: "running", nodes: {}, timeline: [], result: null, published: null,
      createdAt: Date.now(), finishedAt: null
    };
    await this.store.insert("productions", production);
    this.watch(production);
    return { production, balance };
  }

  // ------------------------------------------------------------ watcher
  watch(production) {
    if (this.watching.has(production.id)) return;
    const state = { production, stopped: false, failures: 0 };
    this.watching.set(production.id, state);
    const tick = async () => {
      if (state.stopped) return;
      try {
        const done = await this.poll(state);
        state.failures = 0;
        if (done) { this.watching.delete(production.id); return; }
      } catch (error) {
        state.failures += 1;
        // Compute layer unreachable for ~2 minutes: give up and refund.
        if (state.failures > Math.max(5, Math.round(120_000 / this.pollMs))) {
          await this.finish(state.production, "failed", { error: `Lost contact with the studio pipeline (${error.message})` });
          this.watching.delete(production.id);
          return;
        }
      }
      setTimeout(tick, this.pollMs);
    };
    setTimeout(tick, 10);
  }

  stopAll() { for (const s of this.watching.values()) s.stopped = true; this.watching.clear(); }

  async poll(state) {
    const p = state.production;
    const run = await this.compute.run(p.runId);
    const nodes = { ...(p.nodes || {}) };
    const finishedNow = [];
    for (const n of run.nodes || []) {
      const prev = nodes[n.id];
      if (prev?.status === n.status && !(n.status === "running" && n.progress?.chars && n.progress.chars !== prev.chars)) continue;
      nodes[n.id] = { status: n.status, chars: n.progress?.chars ?? null };
      const employee = ownerOf(n.id);
      if (n.status === "running" && prev?.status !== "running") {
        await this.emit(p, { type: "employee", employee, nodeId: n.id, state: "working", line: startLine(n.id) });
      } else if (n.status === "running" && n.progress?.chars) {
        this.bus.emit(p.id, { type: "progress", employee, nodeId: n.id, chars: n.progress.chars, at: Date.now() });
      } else if (n.status === "waiting") {
        await this.emit(p, { type: "employee", employee, nodeId: n.id, state: "waiting", line: "Waiting for the CEO's approval…" });
      } else if (TERMINAL.has(n.status) && prev?.status !== n.status) {
        finishedNow.push(n);
      }
    }
    if (finishedNow.length) {
      // One read with outputs per poll, only when something finished.
      const full = await this.compute.run(p.runId, true);
      const outputs = Object.fromEntries((full.nodes || []).map((n) => [n.id, n.output]));
      for (const n of finishedNow) {
        const { line, image } = doneLine(n, outputs[n.id]);
        await this.emit(p, { type: "employee", employee: ownerOf(n.id), nodeId: n.id, state: n.status === "failed" || n.status === "blocked" ? "error" : "done", line, image: image ?? null });
      }
    }
    p.nodes = nodes;
    await this.store.update("productions", p.id, { nodes });
    if (run.status === "complete") { await this.finish(p, "complete", { result: run.result }); return true; }
    if (run.status === "failed" || run.status === "cancelled") { await this.finish(p, "failed", { error: run.error || "The build failed" }); return true; }
    return false;
  }

  async finish(p, status, { result, error }) {
    const fields = { status, finishedAt: Date.now() };
    if (status === "complete") {
      fields.result = result ? {
        title: result.title, recipe: result.recipe, style: result.style, playUrl: result.playUrl, coverUrl: result.coverUrl,
        gameId: result.gameId, quality: { codeSource: result.quality?.codeSource, acceptance: result.quality?.acceptance?.ok ?? null, playtest: result.quality?.playtest?.status ?? null },
        durationMs: result.durationMs
      } : null;
      if (p.kind === "build") await this.store.incIf("agencies", p.agencyId, "gamesMade", 1, 0);
    } else {
      fields.error = error;
      fields.refunded = p.cost;
      await this.refund(p.agencyId, p.cost, p.id);
    }
    const updated = await this.store.update("productions", p.id, fields);
    Object.assign(p, fields);
    await this.emit(p, { type: "status", status, result: fields.result ?? null, error: fields.error ?? null, refunded: fields.refunded ?? 0 });
    return updated;
  }

  async resume() {
    const running = await this.store.find("productions", { status: "running" });
    for (const p of running) this.watch(p);
    return running.length;
  }
}
