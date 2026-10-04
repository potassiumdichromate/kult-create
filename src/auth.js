import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyMessage, getAddress, isAddress } from "ethers";
import { config } from "./config.js";

// Wallet sign-in: the client asks for a one-time message, the wallet signs it
// (personal_sign), and we issue an HMAC-signed session token listing the
// wallets the session has proven. A second wallet can be linked the same way
// (e.g. OKX Agentic Wallet holds the identity, another wallet holds the INFT).

const NONCE_TTL_MS = 10 * 60 * 1000;
const challenges = new Map(); // nonce -> { address, purpose, message, exp }

export function normalize(address) {
  if (!isAddress(String(address || ""))) throw Object.assign(new Error("Invalid wallet address"), { status: 400 });
  return getAddress(address).toLowerCase();
}

export function createChallenge(address, purpose = "sign-in") {
  const wallet = normalize(address);
  for (const [n, c] of challenges) if (c.exp < Date.now()) challenges.delete(n);
  const nonce = randomBytes(12).toString("hex");
  const message = [
    purpose === "link" ? "Link this wallet to your Kult Create studio." : "Sign in to Kult Create.",
    "",
    `Wallet: ${getAddress(wallet)}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date().toISOString()}`,
    "",
    "This signature proves you own this wallet. It costs no gas and authorizes no transaction."
  ].join("\n");
  challenges.set(nonce, { address: wallet, purpose, message, exp: Date.now() + NONCE_TTL_MS });
  return { nonce, message };
}

export function verifyChallenge({ nonce, signature, purpose = "sign-in" }) {
  const c = challenges.get(String(nonce || ""));
  if (!c || c.exp < Date.now() || c.purpose !== purpose) throw Object.assign(new Error("Sign-in request expired. Please try again."), { status: 401 });
  challenges.delete(nonce); // one use only
  let signer;
  try { signer = verifyMessage(c.message, String(signature || "")).toLowerCase(); } catch { signer = null; }
  if (signer !== c.address) throw Object.assign(new Error("Signature does not match the wallet"), { status: 401 });
  return c.address;
}

const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (payload) => createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");

export function issueToken(wallets) {
  const payload = b64(JSON.stringify({ w: [...new Set(wallets)], exp: Date.now() + config.sessionDays * 86400000 }));
  return `${payload}.${sign(payload)}`;
}

export function readToken(token) {
  const [payload, mac] = String(token || "").split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!Array.isArray(data.w) || !data.w.length || data.exp < Date.now()) return null;
    return { wallets: data.w };
  } catch { return null; }
}

// Express middleware. EventSource cannot send headers, so the token may also
// come as ?token= on GET requests.
export function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.method === "GET" ? req.query.token : null;
  const session = readToken(token);
  if (!session) { res.status(401).json({ error: "Sign in with your wallet to continue." }); return; }
  req.session = session;
  next();
}
