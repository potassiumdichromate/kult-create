// Client for the Kult Create server. The office talks to the API only through
// this interface; demo.js implements the same interface offline (?demo=1).

const params = new URLSearchParams(location.search);
const BASE = (params.get("api") || "").replace(/\/$/, "");
const TOKEN_KEY = "kultcreate.token";

const storage = {
  get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } }
};

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data || {}; }
}

function wallet() {
  const eth = window.okxwallet || window.ethereum;
  if (!eth) throw new ApiError("No wallet found. Open Kult Create in a browser with OKX Wallet or MetaMask.", 0);
  return eth;
}

async function signWith(purpose) {
  const eth = wallet();
  const [address] = await eth.request({ method: purpose === "link" ? "wallet_requestPermissions" : "eth_requestAccounts", params: purpose === "link" ? [{ eth_accounts: {} }] : undefined })
    .then(async (r) => (purpose === "link" ? eth.request({ method: "eth_accounts" }) : r))
    .catch((e) => { throw new ApiError(e?.message || "Wallet connection was rejected", 0); });
  if (!address) throw new ApiError("No wallet account selected", 0);
  const challenge = await request("POST", "/auth/challenge", { address, purpose });
  const signature = await eth.request({ method: "personal_sign", params: [challenge.message, address] })
    .catch((e) => { throw new ApiError(e?.message || "Signature was rejected", 0); });
  return { nonce: challenge.nonce, signature };
}

async function request(method, path, body) {
  const token = storage.get();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && path !== "/auth/verify") storage.set(null);
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  return data;
}

export const realApi = {
  demo: false,
  hasSession: () => Boolean(storage.get()),
  signOut: () => storage.set(null),
  config: () => request("GET", "/config"),
  async signIn() {
    const proof = await signWith("sign-in");
    const out = await request("POST", "/auth/verify", proof);
    storage.set(out.token);
    return out;
  },
  // Kult World handed us the player's Privy session (see app.js handshake).
  async privySignIn({ accessToken, identityToken }) {
    const out = await request("POST", "/auth/privy", { accessToken, identityToken });
    storage.set(out.token);
    return out;
  },
  async linkWallet() {
    const proof = await signWith("link");
    const out = await request("POST", "/auth/link", proof);
    storage.set(out.token);
    return out;
  },
  me: () => request("GET", "/me"),
  okx: (agentId) => request("GET", `/identity/okx/${encodeURIComponent(agentId)}`),
  candidates: () => request("GET", "/ceo/candidates"),
  register: (body) => request("POST", "/agency", body),
  agency: () => request("GET", "/agency"),
  ledger: () => request("GET", "/ledger"),
  start: (body) => request("POST", "/agency/productions", body),
  production: (id) => request("GET", `/agency/productions/${id}`),
  edit: (id, requestText) => request("POST", `/agency/productions/${id}/edits`, { request: requestText }),
  publish: (id, publish = true) => request("POST", `/agency/productions/${id}/publish`, { publish }),
  // Live office feed (SSE). Reconnects on drop; returns a close function.
  subscribe(id, onEvent) {
    let es, closed = false, retry = 0;
    const open = () => {
      es = new EventSource(`${BASE}/agency/productions/${id}/events?token=${encodeURIComponent(storage.get() || "")}`);
      es.onmessage = (m) => {
        retry = 0;
        const e = JSON.parse(m.data);
        onEvent(e);
        if (e.type === "status" || (e.type === "snapshot" && e.production.status !== "running")) { closed = true; es.close(); }
      };
      es.onerror = () => {
        es.close();
        if (!closed) setTimeout(open, Math.min(15000, 1000 * 2 ** retry++));
      };
    };
    open();
    return () => { closed = true; es?.close(); };
  }
};
