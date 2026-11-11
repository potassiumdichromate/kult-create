import express from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { config, ROOT } from "./config.js";
import { createChallenge, verifyChallenge, issueToken, readToken, requireAuth, normalize } from "./auth.js";
import * as defaultChain from "./chain.js";
import { creatorStudio as defaultStudio, computeLayer as defaultCompute, studioLink, withStudioLink } from "./services.js";
import { EMPLOYEES } from "./employees.js";
import { arenaHealth, arenaEnabled, agentByToken } from "./arena.js";
import { verifyPrivy, privyConfigured } from "./privy.js";
import { buildDashboard } from "./dashboard.js";
import { GAME_ID, buildPlayHtml, publicGameInfo } from "./play.js";

const registerSchema = z.object({
  name: z.string().trim().min(2).max(40),
  tagline: z.string().trim().max(120).optional().default(""),
  // Optional: only for studios that want commercial use on OKX.ai.
  okxAgentId: z.union([z.string(), z.number()]).transform((v) => String(v).trim()).optional().transform((v) => v || undefined),
  // Optional: defaults to the player's own AI Arena agent.
  ceoTokenId: z.union([z.string(), z.number()]).transform(String).optional(),
  ceoName: z.string().trim().max(60).optional()
});
const okxLinkSchema = z.object({ okxAgentId: z.union([z.string(), z.number()]).transform((v) => String(v).trim()) });
const productionSchema = z.object({
  brief: z.string().trim().min(8, "Describe the game in a sentence or two").max(2000),
  mode: z.enum(["pro", "ultra"])
});
const editSchema = z.object({ request: z.string().trim().min(4).max(1000) });
const publishSchema = z.object({ publish: z.boolean().optional().default(true) });

// Production as the office sees it (no internal bookkeeping).
const publicProduction = (p) => p && ({
  id: p.id, kind: p.kind, parentId: p.parentId, mode: p.mode, brief: p.brief, cost: p.cost, status: p.status,
  error: p.error ?? null, refunded: p.refunded ?? 0, result: p.result, published: withStudioLink(p.published),
  createdAt: p.createdAt, finishedAt: p.finishedAt, timeline: p.timeline ?? []
});

export function createApp({ store, productions, chain = defaultChain, studio = defaultStudio, compute = defaultCompute }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb" }));

  // Kult World embeds the office in an iframe and may call the API cross-origin.
  const anyOrigin = config.allowedOrigins.includes("*");
  const frameAncestors = `frame-ancestors ${anyOrigin ? "*" : ["'self'", ...config.allowedOrigins].join(" ")}`;
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && (anyOrigin || config.allowedOrigins.includes(origin))) {
      res.set({ "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
    }
    res.set("Content-Security-Policy", frameAncestors);
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  const agencyFor = async (wallets) => {
    for (const w of wallets) {
      const a = await store.findOne("agencies", { ownerWallets: w });
      if (a) return a;
    }
    return null;
  };
  // Studios registered before the archetype was stored get it filled in from
  // AI Arena the next time they load (the office draws the CEO from it).
  const withArchetype = async (agency) => {
    if (!agency || agency.ceo?.archetype || !arenaEnabled()) return agency;
    try {
      const agent = await agentByToken(agency.ceoTokenId);
      if (!agent?.archetype) return agency;
      const ceo = { ...agency.ceo, archetype: agent.archetype };
      await store.update("agencies", agency.id, { ceo });
      return { ...agency, ceo };
    } catch { return agency; }
  };

  const needAgency = wrap(async (req, res, next) => {
    const agency = await withArchetype(await agencyFor(req.session.wallets));
    if (!agency) { res.status(404).json({ error: "You don't have a studio yet. Register one to enter.", code: "NO_AGENCY" }); return; }
    req.agency = agency;
    next();
  });
  const okxRecord = (okx) => ({ name: okx.name, image: okx.image, description: okx.description, owner: okx.owner, agentWallet: okx.agentWallet, verified: okx.verified });
  const verifiedOkx = async (agentId, wallets) => {
    const okx = await chain.verifyOkxControl(agentId, wallets);
    if (await store.findOne("agencies", { okxAgentId: okx.agentId })) throw Object.assign(new Error(`OKX.ai agent #${okx.agentId} already has a studio`), { status: 409 });
    return okx;
  };
  const ownProduction = wrap(async (req, res, next) => {
    const p = await store.findOne("productions", { id: req.params.id });
    if (!p || p.agencyId !== req.agency.id) { res.status(404).json({ error: "Production not found" }); return; }
    req.production = p;
    next();
  });

  // ------------------------------------------------------------ public
  app.get("/health", wrap(async (_req, res) => {
    let computeOk = false;
    try { computeOk = Boolean((await compute.health()).ok ?? true); } catch { /* reported below */ }
    res.json({
      ok: true, service: "kult-create", storage: store.kind, computeLayer: computeOk ? "ok" : "unreachable", aiArenaDb: await arenaHealth(),
      credits: config.credits, verify: { okx: config.okx.verify, ceoInft: config.inft.mode }
    });
  }));

  app.get("/config", (_req, res) => res.json({
    credits: config.credits,
    modes: Object.fromEntries(Object.entries(config.modes).map(([k, v]) => [k, { label: v.label, cost: config.credits[k] }])),
    employees: EMPLOYEES,
    okx: { chainId: 196, registry: config.okx.registry, verify: config.okx.verify },
    privy: privyConfigured(),
    privyAppId: config.privy.appId || null,
    privyClientId: config.privy.clientId || null,
    aiArenaUrl: config.arena.appUrl,
    embedOrigins: config.allowedOrigins,
    ceo: { chainId: 16661, contract: config.inft.contract, verify: config.inft.mode }
  }));

  // ------------------------------------------------------------ auth
  app.post("/auth/challenge", (req, res, next) => {
    try { res.json(createChallenge(req.body?.address, req.body?.purpose === "link" ? "link" : "sign-in")); } catch (e) { next(e); }
  });

  app.post("/auth/verify", wrap(async (req, res) => {
    const wallet = verifyChallenge({ nonce: req.body?.nonce, signature: req.body?.signature });
    const wallets = [wallet];
    const agency = await agencyFor(wallets);
    // A returning owner gets every wallet already linked to their studio.
    const all = agency ? [...new Set([...wallets, ...agency.ownerWallets])] : wallets;
    res.json({ token: issueToken(all), wallets: all, hasAgency: Boolean(agency) });
  }));

  // Kult World hands over the player's Privy session (iframe postMessage).
  // Every EVM wallet Privy links to the user is trusted, including the
  // embedded wallet AI Arena binds agents to.
  app.post("/auth/privy", wrap(async (req, res) => {
    const { privyUserId, wallets } = await verifyPrivy({ accessToken: req.body?.accessToken, identityToken: req.body?.identityToken });
    const agency = await agencyFor(wallets);
    const all = agency ? [...new Set([...wallets, ...agency.ownerWallets])] : wallets;
    res.json({ token: issueToken(all), wallets: all, privyUserId, hasAgency: Boolean(agency) });
  }));

  // Prove a second wallet (e.g. the one holding the OKX identity or the INFT).
  app.post("/auth/link", requireAuth, wrap(async (req, res) => {
    const wallet = verifyChallenge({ nonce: req.body?.nonce, signature: req.body?.signature, purpose: "link" });
    const wallets = [...new Set([...req.session.wallets, wallet])];
    const agency = await agencyFor(req.session.wallets);
    if (agency && !agency.ownerWallets.includes(wallet)) {
      const other = await store.findOne("agencies", { ownerWallets: wallet });
      if (other) throw Object.assign(new Error("That wallet already belongs to another studio"), { status: 409 });
      await store.update("agencies", agency.id, { ownerWallets: [...agency.ownerWallets, wallet] });
    }
    res.json({ token: issueToken(wallets), wallets });
  }));

  app.get("/me", requireAuth, wrap(async (req, res) => {
    const agency = await withArchetype(await agencyFor(req.session.wallets));
    res.json({ wallets: req.session.wallets, agency });
  }));

  // ------------------------------------------------------------ identity lookups
  app.get("/identity/okx/:agentId", wrap(async (req, res) => {
    const id = await chain.okxIdentity(req.params.agentId);
    const taken = await store.findOne("agencies", { okxAgentId: id.agentId });
    res.json({ ...id, taken: Boolean(taken) });
  }));

  app.get("/ceo/candidates", requireAuth, wrap(async (req, res) => {
    const candidates = await chain.ceoCandidates(req.session.wallets);
    const out = [];
    for (const c of candidates) out.push({ ...c, taken: Boolean(await store.findOne("agencies", { ceoTokenId: c.tokenId })) });
    res.json({ candidates: out, verify: config.inft.mode, contract: config.inft.contract });
  }));

  // ------------------------------------------------------------ agency
  app.post("/agency", requireAuth, wrap(async (req, res) => {
    const body = registerSchema.parse(req.body);
    if (await agencyFor(req.session.wallets)) throw Object.assign(new Error("You already run a studio"), { status: 409 });
    // CEO: the player's own KULT agent. Without an explicit choice, the first
    // agent of theirs that does not already run a studio.
    let ceoTokenId = body.ceoTokenId;
    if (!ceoTokenId) {
      for (const c of await chain.ceoCandidates(req.session.wallets)) {
        if (!(await store.findOne("agencies", { ceoTokenId: c.tokenId }))) { ceoTokenId = c.tokenId; break; }
      }
      if (!ceoTokenId) throw Object.assign(new Error("You need a KULT agent to run a studio. Create one in AI Arena first."), { status: 409, code: "NO_AGENT" });
    }
    const ceo = await chain.verifyCeo(ceoTokenId, req.session.wallets, body.ceoName);
    const okx = body.okxAgentId ? await verifiedOkx(body.okxAgentId, req.session.wallets) : null;
    if (await store.findOne("agencies", { ceoTokenId: ceo.tokenId })) throw Object.assign(new Error(`Agent #${ceo.tokenId} is already CEO of another studio`), { status: 409 });
    const agency = {
      id: `agy_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      name: body.name, tagline: body.tagline,
      ...(okx ? { okxAgentId: okx.agentId, okx: okxRecord(okx) } : { okx: null }),
      ceoTokenId: ceo.tokenId,
      ceo: { tokenId: ceo.tokenId, name: ceo.name, image: ceo.image, verified: ceo.verified, agentId: ceo.agentId ?? null, clan: ceo.clan ?? null, archetype: ceo.archetype ?? null, elo: ceo.elo ?? null, wallet: ceo.wallet ?? ceo.user ?? null },
      ownerWallets: req.session.wallets,
      credits: config.credits.starting,
      gamesMade: 0, gamesPublished: 0,
      createdAt: Date.now()
    };
    await store.insert("agencies", agency);
    await store.insert("ledger", { id: randomUUID(), agencyId: agency.id, delta: config.credits.starting, reason: "Studio grant", ref: null, at: Date.now() });
    res.status(201).json({ agency });
  }));

  // Link an OKX.ai identity later (commercial use: discoverable on OKX.ai).
  app.post("/agency/okx", requireAuth, needAgency, wrap(async (req, res) => {
    const { okxAgentId } = okxLinkSchema.parse(req.body);
    if (req.agency.okxAgentId) throw Object.assign(new Error(`This studio is already linked to OKX.ai agent #${req.agency.okxAgentId}`), { status: 409 });
    const okx = await verifiedOkx(okxAgentId, req.session.wallets);
    const agency = await store.update("agencies", req.agency.id, { okxAgentId: okx.agentId, okx: okxRecord(okx) });
    res.json({ agency });
  }));

  app.get("/agency", requireAuth, needAgency, wrap(async (req, res) => {
    const recent = await store.find("productions", { agencyId: req.agency.id }, { sort: { createdAt: -1 }, limit: 20 });
    res.json({ agency: req.agency, productions: recent.map(({ timeline, ...p }) => publicProduction({ ...p, timeline: [] })) });
  }));

  // The CEO dashboard (only the studio's own wallets can read it).
  app.get("/agency/dashboard", requireAuth, needAgency, wrap(async (req, res) => {
    const range = ["day", "week", "month", "year"].includes(req.query.range) ? req.query.range : "week";
    res.json(await buildDashboard({ store, studio, agency: req.agency, range }));
  }));

  // Top games across every Kult Create studio. Each one is playable in the
  // office through the compute layer run that built it.
  app.get("/games/top", requireAuth, needAgency, wrap(async (req, res) => {
    const { games } = await studio.topGames({ limit: Math.min(Number(req.query.limit) || 20, 50) });
    res.json({
      games: games.map((g, i) => ({
        ...g,
        rank: i + 1,
        mine: g.studio?.agencyId === req.agency.id,
        playUrl: g.computeRunId ? `${config.computeLayer.url}/play/${encodeURIComponent(g.computeRunId)}` : g.playUrl,
        livePageUrl: studioLink(g.playUrl)
      }))
    });
  }));

  // The same list for anyone, signed in or not: Kult World's Game Hub shows it
  // in its Kult Create Games folder. Public fields only.
  app.get("/games/public", wrap(async (req, res) => {
    const { games } = await studio.topGames({ limit: Math.min(Number(req.query.limit) || 30, 50) });
    res.set("Cache-Control", "public, max-age=60").json({
      games: games.map((g, i) => ({
        id: g.id,
        rank: i + 1,
        title: g.title || "Untitled game",
        studio: g.studio?.name || null,
        plays: Number(g.plays) || 0,
        likes: Number(g.likes) || 0,
        playUrl: g.computeRunId ? `${config.computeLayer.url}/play/${encodeURIComponent(g.computeRunId)}` : g.playUrl || null
      }))
    });
  }));

  app.get("/ledger", requireAuth, needAgency, wrap(async (req, res) => {
    res.json({ entries: await store.find("ledger", { agencyId: req.agency.id }, { sort: { at: -1 }, limit: 100 }) });
  }));

  // ------------------------------------------------------------ productions
  app.post("/agency/productions", requireAuth, needAgency, wrap(async (req, res) => {
    const body = productionSchema.parse(req.body);
    const { production, balance } = await productions.create(req.agency, body);
    res.status(202).json({ production: publicProduction(production), credits: balance });
  }));

  app.get("/agency/productions/:id", requireAuth, needAgency, ownProduction, (req, res) => {
    res.json({ production: publicProduction(req.production) });
  });

  // Live office feed. Replays the persisted timeline, then streams new events.
  app.get("/agency/productions/:id/events", requireAuth, needAgency, ownProduction, (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
    const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: "snapshot", production: publicProduction(req.production) });
    if (req.production.status !== "running") { res.end(); return; }
    const unsubscribe = productions.subscribe(req.production.id, (e) => {
      send(e);
      if (e.type === "status") { unsubscribe(); clearInterval(ping); res.end(); }
    });
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => { clearInterval(ping); unsubscribe(); });
  });

  app.post("/agency/productions/:id/edits", requireAuth, needAgency, ownProduction, wrap(async (req, res) => {
    const body = editSchema.parse(req.body);
    const { production, balance } = await productions.edit(req.agency, req.production, body);
    res.status(202).json({ production: publicProduction(production), credits: balance });
  }));

  app.post("/agency/productions/:id/publish", requireAuth, needAgency, ownProduction, wrap(async (req, res) => {
    const { publish } = publishSchema.parse(req.body ?? {});
    const p = req.production;
    if (p.status !== "complete") throw Object.assign(new Error("Only a finished game can be published"), { status: 409 });
    if (p.published?.status === "published" || (p.published && !publish)) { res.json({ published: withStudioLink(p.published) }); return; }
    const a = req.agency;
    const out = await studio.importRun({
      runId: p.runId,
      creatorWallet: a.ceo?.wallet && a.ownerWallets.includes(a.ceo.wallet) ? a.ceo.wallet : a.ownerWallets[0],
      studio: { agencyId: a.id, name: a.name, okxAgentId: a.okxAgentId ?? "", ceoTokenId: a.ceoTokenId, ceoName: a.ceo.name },
      publish,
      gameId: p.published?.gameId
    });
    const published = { gameId: out.gameId, playUrl: out.playUrl, status: out.status || (publish ? "published" : "draft"), at: Date.now() };
    await store.update("productions", p.id, { published });
    await store.update("agencies", a.id, publish ? { gamesPublished: (a.gamesPublished || 0) + 1 } : {});
    res.json({ published: withStudioLink(published) });
  }));

  // ------------------------------------------------------------ OKX gateway
  // The Kult OKX gateway sells a studio's builds to OKX users, paid per call
  // (x402) straight to the owner. It finds a player's studio by wallet, starts
  // a build after the buyer's payment is verified, and polls it to delivery.
  // The build spends the studio's credits like any other production.
  const gatewayAuth = (req, res, next) => {
    const key = req.get("x-kult-gateway-key") || "";
    const want = config.gateway.key;
    if (!want) { res.status(503).json({ error: "The OKX gateway is not configured on this studio service" }); return; }
    if (key.length !== want.length || !timingSafeEqual(Buffer.from(key), Buffer.from(want))) { res.status(401).json({ error: "Bad gateway key" }); return; }
    next();
  };
  const gatewayStudio = (a) => ({ id: a.id, name: a.name, tagline: a.tagline ?? "", credits: a.credits, okxAgentId: a.okxAgentId ?? null,
    ceo: { name: a.ceo?.name ?? null, archetype: a.ceo?.archetype ?? null, agentId: a.ceo?.agentId ?? null }, gamesMade: a.gamesMade ?? 0 });
  const gatewayBuildSchema = z.object({ brief: z.string().trim().min(8).max(2000), mode: z.enum(["pro", "ultra"]).optional().default("pro") });

  app.get("/gateway/studios", gatewayAuth, wrap(async (req, res) => {
    const wallets = String(req.query.wallets || "").split(",").map((w) => w.trim()).filter(Boolean).map(normalize);
    const agency = wallets.length ? await agencyFor(wallets) : null;
    res.json({ studios: agency ? [gatewayStudio(agency)] : [] });
  }));

  app.post("/gateway/studios/:id/productions", gatewayAuth, wrap(async (req, res) => {
    const agency = await store.findOne("agencies", { id: req.params.id });
    if (!agency) { res.status(404).json({ error: "Studio not found" }); return; }
    const body = gatewayBuildSchema.parse(req.body);
    const { production, balance } = await productions.create(agency, body);
    res.status(202).json({ production: publicProduction(production), credits: balance });
  }));

  app.get("/gateway/studios/:id/productions/:pid", gatewayAuth, wrap(async (req, res) => {
    const p = await store.findOne("productions", { id: req.params.pid });
    if (!p || p.agencyId !== req.params.id) { res.status(404).json({ error: "Production not found" }); return; }
    res.json({ production: publicProduction(p) });
  }));

  // ------------------------------------------------------------ play
  // Anyone with a link can play a published game: /play?gameId=…
  const playableGame = async (gameId) => {
    const notFound = () => Object.assign(new Error("Game not found"), { status: 404 });
    if (!GAME_ID.test(gameId)) throw notFound();
    const { game } = await studio.game(gameId);
    if (!game?.refinement?.generatedCode) throw notFound();
    return game;
  };

  app.get("/play", (_req, res) => { res.set("Cache-Control", "no-cache").sendFile(join(ROOT, "public", "play", "index.html")); });

  app.get("/play/:gameId/info", wrap(async (req, res) => {
    res.set("Cache-Control", "public, max-age=60").json(publicGameInfo(await playableGame(req.params.gameId)));
  }));

  // The sandbox here applies even if this URL is opened directly (see play.js).
  app.get("/play/:gameId/game.html", wrap(async (req, res) => {
    const game = await playableGame(req.params.gameId);
    res.set({ "Content-Security-Policy": `sandbox allow-scripts; ${frameAncestors}`, "Cache-Control": "public, max-age=60" }).type("html").send(buildPlayHtml(game));
  }));

  // Links built from a host with no scheme resolved against the office page, as
  // /office/create.kult.games/play?gameId=…. Keep the ones already handed out working.
  app.get(/^\/office\/[^/]+\.[^/]+\/play\/?$/, (req, res) => {
    const query = req.originalUrl.indexOf("?");
    res.redirect(301, `/play${query < 0 ? "" : req.originalUrl.slice(query)}`);
  });

  // ------------------------------------------------------------ office
  // Drop-in script Kult World loads to open the office (cross-origin <script>).
  app.get("/embed.js", (_req, res) => { res.set("Cache-Control", "public, max-age=300"); res.sendFile(join(ROOT, "public", "embed.js")); });
  // The page links its CSS and scripts under /office/v/<build>/, so each deploy
  // has new URLs and no cache in front (Cloudflare's browser TTL included) can
  // keep an old office; the scripts' relative imports follow the same prefix.
  // The page itself is never cached.
  const office = join(ROOT, "public", "office");
  const build = (process.env.RENDER_GIT_COMMIT || "").slice(0, 12) || Date.now().toString(36);
  const officePage = readFileSync(join(office, "index.html"), "utf8")
    .replace(/(<(?:link|script)\b[^>]*\b(?:href|src)=")(?![a-z]+:|\/|\?|#)([^"]+")/g, `$1v/${build}/$2`);
  app.get(["/office/", "/office/index.html"], (req, res) => {
    // Its links are relative: /office must become /office/ (routing isn't strict).
    if (req.path === "/office") { res.redirect(301, `/office/${req.originalUrl.slice("/office".length)}`); return; }
    if (config.demo && req.query.demo === undefined) {
      const q = new URLSearchParams(req.originalUrl.split("?")[1] || ""); q.set("demo", "1");
      res.set("Cache-Control", "no-store").redirect(302, `${req.path}?${q}`); return;
    }
    res.set("Cache-Control", "no-store").type("html").send(officePage);
  });
  const versioned = express.static(office, { setHeaders: (r) => r.set("Cache-Control", "public, max-age=31536000, immutable") });
  const stale = express.static(office, { setHeaders: (r) => r.set("Cache-Control", "no-cache") });
  app.use("/office/v/:build", (req, res, next) => (req.params.build === build ? versioned : stale)(req, res, next));
  // Unversioned office files (models, the Privy bundle) revalidate on every
  // load (ETag); the Privy bundle's hashed chunks never change and cache forever.
  app.use("/office", express.static(office, {
    setHeaders: (res, path) => {
      res.set("Cache-Control", /[\\/]privy[\\/]chunks[\\/]/.test(path) ? "public, max-age=31536000, immutable" : "no-cache");
    }
  }));
  app.get("/", (_req, res) => res.redirect(302, "/office/"));

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues.map((i) => i.message).join("; ") }); return; }
    const status = error.status || 500;
    if (status >= 500) console.error("[kult-create]", error);
    res.status(status).json({ error: status >= 500 && !error.upstream && !error.expose ? "Something went wrong" : error.message, ...(error.ownerWallet ? { ownerWallet: error.ownerWallet } : {}), ...(error.code && typeof error.code === "string" && /^[A-Z_]+$/.test(error.code) ? { code: error.code } : {}) });
  });

  return app;
}

export { readToken, normalize };
