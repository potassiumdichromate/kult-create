import { test } from "node:test";
import assert from "node:assert/strict";

// CEO verification in "arena" mode: AI Arena's database (faked here) binds the
// agent to the player's wallet, and the live 0G contract must map that agent's
// ID to the token. Reads 0G mainnet; tokens #1 and #1452 are real AI Arena agents.
process.env.CEO_INFT_VERIFY = "arena";
const { setArenaForTests } = await import("../src/arena.js");
const { verifyCeo, ceoCandidates } = await import("../src/chain.js");

const PLAYER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const rows = [
  { agentId: "ca64007d-5095-4eae-b109-59fe3882aee3", name: "Nova", clan: "ZEROG", evolutionStage: "GENESIS", elo: 1200, wins: 3, losses: 1, tokenId: "1", wallet: PLAYER },
  // Wrong pairing: this agent ID is token #1452 on chain, not #700.
  { agentId: "8e4ca4b1-43a7-4143-860b-5b1b2285f705", name: "Imposter", clan: "ZEROG", evolutionStage: "GENESIS", elo: 1000, wins: 0, losses: 0, tokenId: "700", wallet: PLAYER }
];
setArenaForTests({
  agentsForWallets: async (wallets) => rows.filter((r) => wallets.includes(r.wallet)),
  agentByToken: async (tokenId) => rows.find((r) => r.tokenId === tokenId) ?? null
});

test("the player's AI Arena agent is accepted as CEO", async () => {
  const ceo = await verifyCeo("1", [PLAYER]);
  assert.equal(ceo.verified, true);
  assert.equal(ceo.name, "Nova");
  assert.equal(ceo.agentId, rows[0].agentId);
  assert.equal(ceo.owner, "0x043091b10bbcd3f8c5158c27ad291cc56b4f46db");
});

test("someone else's agent is refused", async () => {
  await assert.rejects(verifyCeo("1", [OTHER]), (e) => e.status === 403 && /belongs to the AI Arena account 0x1111…1111/.test(e.message));
});

test("a database row that disagrees with the chain is refused", async () => {
  await assert.rejects(verifyCeo("700", [PLAYER]), (e) => e.status === 409);
});

test("an INFT that AI Arena does not know is refused", async () => {
  await assert.rejects(verifyCeo("5", [PLAYER]), (e) => e.status === 404);
});

test("candidates list the player's AI Arena agents", async () => {
  const list = await ceoCandidates([PLAYER]);
  assert.deepEqual(list.map((c) => c.name), ["Nova", "Imposter"]);
  assert.equal((await ceoCandidates([OTHER])).length, 0);
});
