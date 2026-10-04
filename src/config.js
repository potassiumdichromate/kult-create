import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader (no dependency): KEY=value lines, existing env wins.
const envFile = join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const env = (key, fallback) => {
  const v = process.env[key];
  return v !== undefined && v !== "" ? v : fallback;
};
const num = (key, fallback) => {
  const n = Number(env(key, ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const isProd = env("NODE_ENV", "development") === "production";

export const config = {
  isProd,
  port: num("PORT", 4300),
  publicUrl: env("PUBLIC_URL", `http://localhost:${num("PORT", 4300)}`).replace(/\/$/, ""),
  // Session tokens are HMAC-signed with this secret. Required in production.
  sessionSecret: env("SESSION_SECRET", isProd ? "" : randomBytes(32).toString("hex")),
  sessionDays: num("SESSION_DAYS", 7),
  // Origins allowed to embed the office (Kult World) and call the API.
  allowedOrigins: env("ALLOWED_ORIGINS", "*").split(",").map((s) => s.trim()).filter(Boolean),

  // Storage: MongoDB when MONGODB_URI is set, otherwise a JSON file (dev / single instance).
  mongoUri: env("MONGODB_URI", ""),
  mongoDb: env("MONGODB_DB", "kult_create"),
  dataFile: resolve(env("DATA_FILE", join(ROOT, "data", "kult-create.json"))),

  // Credits economy. Each agency starts with STARTING_CREDITS.
  credits: {
    starting: num("STARTING_CREDITS", 1000),
    pro: num("CREDIT_COST_PRO", 40),
    ultra: num("CREDIT_COST_ULTRA", 100),
    edit: num("CREDIT_COST_EDIT", 10)
  },
  // Production modes map onto compute-layer quality tiers.
  modes: { pro: { tier: 2, label: "Pro" }, ultra: { tier: 3, label: "Ultra" } },

  // OKX.ai identity: ERC-8004 IdentityRegistry on X Layer (chain 196).
  okx: {
    rpc: env("XLAYER_RPC_URL", "https://rpc.xlayer.tech"),
    registry: env("OKX_IDENTITY_REGISTRY", "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"),
    verify: env("OKX_IDENTITY_VERIFY", "on") !== "off"
  },
  // CEO: the owner's persistent KULT Agent, an AI Arena INFT (ERC-7857) on 0G mainnet.
  // AI Arena mints every agent to its own custodian wallet, so plain ownerOf()
  // never names the player. A wallet proves control when it owns the token or
  // has been granted ERC-7857 usage (hasValidUsage). CEO_INFT_VERIFY:
  //   arena     — those two, or AI Arena's database binds the agent to the
  //               wallet (and the contract maps the agent ID to the token)
  //   strict    — only those two proofs count
  //   custodial — also accept agents still held by the AI Arena custodian
  //               (no on-chain link to the player yet; first studio to claim wins)
  //   off       — no chain reads at all (tests)
  inft: {
    rpc: env("ZEROG_RPC_URL", "https://evmrpc.0g.ai"),
    contract: env("CEO_INFT_CONTRACT", "0xA8A5a1D6AA3BF4575f6a1031966C8079BD4e9b9b"),
    custodian: env("CEO_INFT_CUSTODIAN", "0x043091b10bBcD3F8C5158C27AD291CC56B4F46db").toLowerCase(),
    mode: ((m) => (["arena", "strict", "custodial", "off"].includes(m) ? m : "strict"))(env("CEO_INFT_VERIFY", env("AI_ARENA_DATABASE_URL", "") ? "arena" : "custodial")),
    get verify() { return this.mode !== "off"; }
  },

  // Privy: the same app Kult World and AI Arena sign players in with.
  privy: {
    appId: env("PRIVY_APP_ID", ""),
    verificationKey: "",
    appSecret: env("PRIVY_APP_SECRET", "")
  },

  // AI Arena's Postgres (read-only): which player owns which agent.
  arena: { databaseUrl: env("AI_ARENA_DATABASE_URL", "") },

  // Services this building uses.
  computeLayer: { url: env("COMPUTE_LAYER_URL", "http://localhost:4100").replace(/\/$/, ""), key: env("COMPUTE_LAYER_KEY", "") },
  creatorStudio: { url: env("CREATOR_STUDIO_URL", "http://localhost:3001").replace(/\/$/, ""), key: env("CREATOR_STUDIO_KEY", "") },
  pollMs: num("PRODUCTION_POLL_MS", 2000)
};

// Privy's dashboard may give the verification key as a bare base64 body, or
// with escaped newlines; the SDK needs a PEM.
config.privy.verificationKey = ((value) => {
  const key = String(value ?? "").trim().replace(/\\n/g, "\n").replace(/^["']|["']$/g, "").trim();
  if (!key || key.startsWith("-----BEGIN")) return key;
  const compact = key.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return key;
  return `-----BEGIN PUBLIC KEY-----\n${compact.match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----`;
})(env("PRIVY_VERIFICATION_KEY", ""));

export function assertConfig() {
  const problems = [];
  if (!config.sessionSecret) problems.push("SESSION_SECRET is required in production");
  if (config.isProd && !config.computeLayer.key) problems.push("COMPUTE_LAYER_KEY is required in production");
  if (config.inft.mode === "arena" && !config.arena.databaseUrl) problems.push("CEO_INFT_VERIFY=arena needs AI_ARENA_DATABASE_URL");
  return problems;
}
