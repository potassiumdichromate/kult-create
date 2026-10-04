import { PrivyClient, verifyAccessToken, verifyIdentityToken } from "@privy-io/node";
import { config } from "./config.js";

// Privy sign-in for players who arrive from Kult World. Kult World (the
// iframe's parent) hands over the player's Privy tokens; we verify them with
// the app's verification key and trust every EVM wallet Privy has linked to
// that user, including the Privy embedded wallet that AI Arena binds agents to.
// Same verification as creator-studio's authService.

export const privyConfigured = () => Boolean(config.privy.appId && config.privy.verificationKey);

const isEvm = (a) => /^0x[a-fA-F0-9]{40}$/.test(String(a || ""));

// Every EVM wallet on the Privy user: embedded and external.
export function evmWalletsOf(user) {
  const accounts = user?.linked_accounts ?? user?.linkedAccounts ?? [];
  const wallets = accounts
    .filter((a) => a?.type === "wallet" && isEvm(a.address) && (a.chain_type ?? a.chainType ?? "ethereum") === "ethereum")
    .map((a) => a.address.toLowerCase());
  if (isEvm(user?.wallet?.address)) wallets.push(user.wallet.address.toLowerCase());
  return [...new Set(wallets)];
}

let client = null;
const privyClient = () => (client ??= new PrivyClient({ appId: config.privy.appId, appSecret: config.privy.appSecret }));

// Returns { privyUserId, wallets }. Test code may replace the verifiers.
let verifiers = { verifyAccessToken, verifyIdentityToken, fetchUser: (id) => privyClient().users()._get(id) };
export function setPrivyForTests(impl) { verifiers = impl ? { ...verifiers, ...impl } : { verifyAccessToken, verifyIdentityToken, fetchUser: (id) => privyClient().users()._get(id) }; }

export async function verifyPrivy({ accessToken, identityToken }) {
  if (!privyConfigured()) throw Object.assign(new Error("Privy sign-in is not enabled on this server"), { status: 503 });
  if (!accessToken && !identityToken) throw Object.assign(new Error("Privy token required"), { status: 401 });
  const auth = { app_id: config.privy.appId, verification_key: config.privy.verificationKey };
  let access = null, user = null;
  try {
    if (accessToken) access = await verifiers.verifyAccessToken({ access_token: accessToken, ...auth });
    if (identityToken) user = await verifiers.verifyIdentityToken({ identity_token: identityToken, ...auth });
  } catch (cause) {
    throw Object.assign(new Error("Your Kult World session could not be verified. Sign in again."), { status: 401, cause });
  }
  if (access && user && access.user_id !== user.id) throw Object.assign(new Error("Privy token user mismatch"), { status: 401 });
  // An access token alone carries no wallets; look the user up with the app secret.
  if (!user && access) {
    if (!config.privy.appSecret) throw Object.assign(new Error("Send the Privy identity token (or set PRIVY_APP_SECRET)"), { status: 401 });
    user = await verifiers.fetchUser(access.user_id);
  }
  const wallets = evmWalletsOf(user);
  if (!wallets.length) throw Object.assign(new Error("Your Kult World account has no EVM wallet yet."), { status: 409 });
  return { privyUserId: user.id ?? access?.user_id, wallets };
}
