import { Contract, JsonRpcProvider } from "ethers";
import { config } from "./config.js";
import { arenaEnabled, agentsForWallets, agentByToken } from "./arena.js";

// On-chain reads (no keys, no transactions):
//   OKX.ai identity  — ERC-8004 IdentityRegistry on X Layer: an agent is an ERC-721
//                       token; ownerOf(agentId) / getAgentWallet(agentId) prove control,
//                       tokenURI is its Agent Card (name, image, description).
//   CEO              — the owner's AI Arena INFT (ERC-7857, ERC-721 Enumerable) on 0G mainnet.

const REGISTRY_ABI = [
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "function getAgentWallet(uint256) view returns (address)"
];
const INFT_ABI = [
  "function ownerOf(uint256) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)",
  "function tokenURI(uint256) view returns (string)",
  "function hasValidUsage(uint256,address) view returns (bool)",
  "function getEvolutionStage(uint256) view returns (uint8)",
  "function agentIdToTokenId(string) view returns (uint256)"
];

let xlayer, zerog;
const registry = () => new Contract(config.okx.registry, REGISTRY_ABI, (xlayer ??= new JsonRpcProvider(config.okx.rpc, 196, { staticNetwork: true })));
const inft = () => new Contract(config.inft.contract, INFT_ABI, (zerog ??= new JsonRpcProvider(config.inft.rpc, 16661, { staticNetwork: true })));

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, exp: Date.now() + ttlMs });
  return value;
}

// Agent Cards and INFT metadata: data: URIs or https JSON. Never throws.
async function readCard(uri) {
  try {
    if (!uri) return {};
    if (uri.startsWith("data:")) {
      const [, meta, body] = uri.match(/^data:([^,]*),(.*)$/s) || [];
      const text = meta?.includes("base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
      return JSON.parse(text);
    }
    const url = uri.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${uri.slice(7)}` : uri;
    if (!/^https:\/\//.test(url)) return {};
    const ctl = AbortSignal.timeout(6000);
    const res = await fetch(url, { signal: ctl });
    if (!res.ok) return {};
    const type = res.headers.get("content-type") || "";
    if (type.startsWith("image/")) return { image: url };
    return await res.json();
  } catch { return {}; }
}

const parseId = (value) => {
  const s = String(value ?? "").replace(/^#/, "").trim();
  if (!/^\d{1,30}$/.test(s)) throw Object.assign(new Error("Enter a numeric ID"), { status: 400 });
  return s;
};

export async function okxIdentity(agentIdInput) {
  const agentId = parseId(agentIdInput);
  return cached(`okx:${agentId}`, 60_000, async () => {
    let owner;
    try { owner = (await registry().ownerOf(agentId)).toLowerCase(); } catch {
      throw Object.assign(new Error(`OKX.ai agent #${agentId} does not exist on X Layer`), { status: 404 });
    }
    let agentWallet = null;
    try { agentWallet = (await registry().getAgentWallet(agentId)).toLowerCase(); } catch { /* optional */ }
    let uri = null;
    try { uri = await registry().tokenURI(agentId); } catch { /* optional */ }
    const card = await readCard(uri);
    return {
      agentId, owner, agentWallet,
      name: String(card.name || `OKX.ai Agent #${agentId}`).slice(0, 80),
      description: String(card.description || "").slice(0, 400),
      image: typeof card.image === "string" ? card.image : null,
      chain: "X Layer (196)",
      registry: config.okx.registry
    };
  });
}

export async function verifyOkxControl(agentId, wallets) {
  const id = await okxIdentity(agentId);
  if (!config.okx.verify) return { ...id, verified: false };
  if (!wallets.includes(id.owner) && !(id.agentWallet && wallets.includes(id.agentWallet))) {
    throw Object.assign(new Error(`OKX.ai agent #${id.agentId} belongs to ${id.owner}. Sign in with (or link) that wallet.`), { status: 403, ownerWallet: id.owner });
  }
  return { ...id, verified: true };
}

async function inftMeta(tokenId) {
  return cached(`inft:${tokenId}`, 600_000, () => readInftMeta(tokenId));
}
async function readInftMeta(tokenId) {
  let uri = null;
  try { uri = await inft().tokenURI(tokenId); } catch { /* optional */ }
  const card = await readCard(uri);
  return { tokenId: String(tokenId), name: String(card.name || `KULT Agent #${tokenId}`).slice(0, 60), image: typeof card.image === "string" ? card.image : null };
}

const arenaView = (a, onchain) => ({
  tokenId: String(a.tokenId), name: String(a.name).slice(0, 60), image: null,
  agentId: a.agentId, clan: a.clan, evolutionStage: a.evolutionStage, elo: a.elo, owner: onchain ?? null, wallet: a.wallet
});
const mask = (w) => `${w.slice(0, 6)}…${w.slice(-4)}`;

// The wallets' agents, for the "choose your CEO" step. AI Arena agents come
// from its database (their INFTs sit in the custodian wallet); self-custodied
// INFTs are found on chain.
export async function ceoCandidates(wallets) {
  const out = [];
  if (config.inft.mode === "arena" && arenaEnabled()) {
    for (const a of await agentsForWallets(wallets)) out.push(arenaView(a));
  }
  for (const w of wallets) {
    let n = 0;
    try { n = Number(await inft().balanceOf(w)); } catch { continue; }
    for (let i = 0; i < Math.min(n, 20); i += 1) {
      try {
        const tokenId = await inft().tokenOfOwnerByIndex(w, i);
        if (!out.some((c) => c.tokenId === String(tokenId))) out.push({ ...(await inftMeta(tokenId)), owner: w });
      } catch { break; }
    }
  }
  return out;
}

// Proves a signed-in wallet controls the CEO agent. verified is
//   true        — the wallet owns the INFT, holds ERC-7857 usage rights, or
//                 (arena mode) AI Arena's database binds the agent to the
//                 wallet AND the contract maps that agent's ID to this token
//   "custodial" — accepted only because AI Arena's custodian holds it
export async function verifyCeo(tokenIdInput, wallets, fallbackName) {
  const tokenId = parseId(tokenIdInput);
  const name = (meta) => (fallbackName && /^KULT Agent #/.test(meta.name) ? String(fallbackName).slice(0, 60) : meta.name);
  if (!config.inft.verify) return { tokenId, name: String(fallbackName || `KULT Agent #${tokenId}`).slice(0, 60), image: null, verified: false };
  let owner;
  try { owner = (await inft().ownerOf(tokenId)).toLowerCase(); } catch {
    throw Object.assign(new Error(`KULT Agent INFT #${tokenId} does not exist on 0G`), { status: 404 });
  }
  if (wallets.includes(owner)) { const meta = await inftMeta(tokenId); return { ...meta, name: name(meta), owner, verified: true }; }
  for (const w of wallets) {
    let ok = false;
    try { ok = await inft().hasValidUsage(tokenId, w); } catch { /* not ERC-7857 */ }
    if (ok) { const meta = await inftMeta(tokenId); return { ...meta, name: name(meta), owner, user: w, verified: true }; }
  }
  if (config.inft.mode === "arena" && arenaEnabled()) {
    const agent = await agentByToken(tokenId);
    if (!agent) throw Object.assign(new Error(`KULT Agent #${tokenId} is not registered in AI Arena`), { status: 404 });
    if (!wallets.includes(agent.wallet)) {
      throw Object.assign(new Error(`KULT Agent #${tokenId} belongs to the AI Arena account ${mask(agent.wallet)}. Sign in with (or link) that wallet.`), { status: 403, ownerWallet: agent.wallet });
    }
    // The INFT was minted with the AI Arena agent ID; make sure the chain agrees.
    let onchainToken = null;
    try { onchainToken = String(await inft().agentIdToTokenId(agent.agentId)); } catch { /* checked below */ }
    if (onchainToken !== tokenId) throw Object.assign(new Error(`AI Arena agent "${agent.name}" does not match INFT #${tokenId} on 0G`), { status: 409 });
    return { ...arenaView(agent, owner), verified: true };
  }
  if (config.inft.mode === "custodial" && owner === config.inft.custodian) {
    const meta = await inftMeta(tokenId);
    return { ...meta, name: name(meta), owner, verified: "custodial" };
  }
  throw Object.assign(new Error(`KULT Agent #${tokenId} is not linked to your wallet. Sign in with (or link) the wallet you use for AI Arena.`), { status: 403, ownerWallet: owner });
}
