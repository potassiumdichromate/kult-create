import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, exportSPKI, SignJWT } from "jose";

// Privy sign-in from Kult World, through Privy's real verifier
// (@privy-io/node) with tokens signed by a throwaway ES256 key.

const APP_ID = "test-kult-app";
const { publicKey, privateKey } = await generateKeyPair("ES256");
const other = await generateKeyPair("ES256");
process.env.PRIVY_APP_ID = APP_ID;
process.env.PRIVY_VERIFICATION_KEY = await exportSPKI(publicKey);
process.env.PRIVY_APP_SECRET = "";
process.env.CEO_INFT_VERIFY = "off";
process.env.OKX_IDENTITY_VERIFY = "off";

const { createStore } = await import("../src/store/index.js");
const { Productions } = await import("../src/productions.js");
const { createApp } = await import("../src/app.js");

const EMBEDDED = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const EXTERNAL = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";

const sign = (claims, { key = privateKey, aud = APP_ID, sub = "did:privy:player1" } = {}) =>
  new SignJWT(claims).setProtectedHeader({ alg: "ES256", typ: "JWT" }).setIssuer("privy.io").setAudience(aud).setSubject(sub)
    .setIssuedAt().setExpirationTime("1h").sign(key);
const identityToken = (accounts, opts) => sign({ cr: String(Math.floor(Date.now() / 1000)), linked_accounts: JSON.stringify(accounts) }, opts);
const accessToken = (opts) => sign({ sid: "session-1" }, opts);
const ACCOUNTS = [
  { type: "wallet", wallet_client_type: "privy", id: "w1", address: EMBEDDED, chain_type: "ethereum", lv: 1 },
  { type: "wallet", address: EXTERNAL, chain_type: "ethereum", lv: 1 },
  { type: "wallet", address: "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2", chain_type: "solana", lv: 1 },
  { type: "email", address: "player@example.com", lv: 1 }
];

const fakeChain = {
  okxIdentity: async (id) => ({ agentId: String(id), owner: EXTERNAL.toLowerCase(), agentWallet: null, name: `Agent ${id}`, image: null }),
  verifyOkxControl: async (id) => ({ agentId: String(id), owner: EXTERNAL.toLowerCase(), name: `Agent ${id}`, verified: false }),
  ceoCandidates: async () => [],
  verifyCeo: async (tokenId, _w, name) => ({ tokenId: String(tokenId), name: name || "Nova", verified: false })
};

const dir = mkdtempSync(join(tmpdir(), "kult-create-privy-"));
let server, base, store, productions;
before(async () => {
  store = await createStore({ mongoUri: "", dataFile: join(dir, "db.json") });
  productions = new Productions({ store, compute: { health: async () => ({ ok: true }) }, pollMs: 50 });
  const app = createApp({ store, productions, chain: fakeChain, studio: {}, compute: { health: async () => ({ ok: true }) } });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await store.close(); rmSync(dir, { recursive: true, force: true }); });

const call = async (method, path, body, token) => {
  const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})), text: res.headers.get("content-type") };
};

test("config tells the office that Privy sign-in is available", async () => {
  const r = await call("GET", "/config");
  assert.equal(r.body.privy, true);
});

test("a Kult World Privy session signs the player in with all their EVM wallets", async () => {
  const r = await call("POST", "/auth/privy", { accessToken: await accessToken(), identityToken: await identityToken(ACCOUNTS) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.wallets.sort(), [EMBEDDED.toLowerCase(), EXTERNAL.toLowerCase()].sort());
  assert.equal(r.body.privyUserId, "did:privy:player1");
  assert.equal(r.body.hasAgency, false);
  const me = await call("GET", "/me", null, r.body.token);
  assert.equal(me.status, 200);
  // The Privy wallets can register a studio straight away.
  const reg = await call("POST", "/agency", { name: "Privy Studio", okxAgentId: "5", ceoTokenId: "9" }, r.body.token);
  assert.equal(reg.status, 201);
  assert.ok(reg.body.agency.ownerWallets.includes(EMBEDDED.toLowerCase()));
});

test("a returning player walks straight into their studio", async () => {
  const r = await call("POST", "/auth/privy", { identityToken: await identityToken(ACCOUNTS) });
  assert.equal(r.status, 200);
  assert.equal(r.body.hasAgency, true);
});

test("tokens from another key, another app, or another user are refused", async () => {
  const forged = await call("POST", "/auth/privy", { identityToken: await identityToken(ACCOUNTS, { key: other.privateKey }) });
  assert.equal(forged.status, 401);
  const wrongApp = await call("POST", "/auth/privy", { identityToken: await identityToken(ACCOUNTS, { aud: "some-other-app" }) });
  assert.equal(wrongApp.status, 401);
  const mismatch = await call("POST", "/auth/privy", { accessToken: await accessToken({ sub: "did:privy:someone-else" }), identityToken: await identityToken(ACCOUNTS) });
  assert.equal(mismatch.status, 401);
  assert.equal((await call("POST", "/auth/privy", {})).status, 401);
});

test("an access token alone needs the identity token (no app secret set)", async () => {
  const r = await call("POST", "/auth/privy", { accessToken: await accessToken() });
  assert.equal(r.status, 401);
  assert.match(r.body.error, /identity token/);
});

test("a Privy account without an EVM wallet cannot sign in", async () => {
  const r = await call("POST", "/auth/privy", { identityToken: await identityToken([{ type: "email", address: "x@example.com", lv: 1 }], { sub: "did:privy:nowallet" }) });
  assert.equal(r.status, 409);
});

test("the Kult World embed script is served", async () => {
  const res = await fetch(`${base}/embed.js`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /window\.KultCreate = /);
});
