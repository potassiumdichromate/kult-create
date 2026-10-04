import pg from "pg";
import { config } from "./config.js";

// Read-only access to the AI Arena database, the source of truth for which
// player owns which agent: AI Arena keeps every INFT in its custodian wallet,
// and binds agents to players here (User.walletAddress ← Agent.userId, with
// Agent.inftTokenId set once the INFT is minted). One agent per wallet.

let pool = null;
let override = null; // tests: { agentsForWallets, agentByToken }
export function setArenaForTests(impl) { override = impl; }
function db() {
  if (!config.arena.databaseUrl) return null;
  pool ??= new pg.Pool({
    connectionString: config.arena.databaseUrl,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 5_000,
    ssl: /sslmode=(require|verify)/.test(config.arena.databaseUrl) || /render\.com|neon\.tech|supabase/.test(config.arena.databaseUrl) ? { rejectUnauthorized: false } : undefined,
    // Never write to the AI Arena database.
    options: "-c default_transaction_read_only=on"
  });
  return pool;
}

const AGENT_COLUMNS = `
  a.id, a.name, a.clan::text AS clan, a."evolutionStage"::text AS "evolutionStage", a."eloRating", a.wins, a.losses,
  a."inftTokenId", lower(u."walletAddress") AS wallet`;

const toAgent = (r) => ({
  agentId: r.id, name: r.name, clan: r.clan, evolutionStage: r.evolutionStage,
  elo: r.eloRating, wins: r.wins, losses: r.losses, tokenId: r.inftTokenId, wallet: r.wallet
});

export const arenaEnabled = () => Boolean(override || config.arena.databaseUrl);

// The live (not retired) agents with a minted INFT owned by any of these wallets.
export async function agentsForWallets(wallets) {
  if (override) return override.agentsForWallets(wallets);
  const p = db();
  if (!p || !wallets.length) return [];
  const { rows } = await p.query(
    `SELECT ${AGENT_COLUMNS}
       FROM "Agent" a JOIN "User" u ON u.id = a."userId"
      WHERE lower(u."walletAddress") = ANY($1::text[]) AND a."isRetired" = false AND a."inftTokenId" IS NOT NULL
      ORDER BY a."createdAt" ASC LIMIT 20`,
    [wallets.map((w) => w.toLowerCase())]
  );
  return rows.map(toAgent);
}

export async function agentByToken(tokenId) {
  if (override) return override.agentByToken(String(tokenId));
  const p = db();
  if (!p) return null;
  const { rows } = await p.query(
    `SELECT ${AGENT_COLUMNS}
       FROM "Agent" a JOIN "User" u ON u.id = a."userId"
      WHERE a."inftTokenId" = $1 AND a."isRetired" = false LIMIT 1`,
    [String(tokenId)]
  );
  return rows[0] ? toAgent(rows[0]) : null;
}

export async function arenaHealth() {
  const p = db();
  if (!p) return "not configured";
  try { await p.query("SELECT 1 FROM \"Agent\" LIMIT 1"); return "ok"; } catch (e) { return `error: ${e.message}`; }
}

export async function closeArena() { await pool?.end(); pool = null; }
