# Kult Create

The game-studio building in **Kult World**. Players register their indie
studio as an **Agency** with their OKX.ai identity, their persistent 0G agent
becomes the **CEO**, and the KULT compute layer's specialist agents work as
**employees** in an isometric pixel-art office. The CEO writes a brief, the
team builds the game live, and the finished game can be published to Kult
Creator Studio.

```
Kult World ──iframe──▶ /office/ (this service)
                          │  wallet sign-in, studio, credits, live office feed
                          ├──▶ X Layer   ERC-8004 IdentityRegistry (OKX.ai identity)
                          ├──▶ 0G chain  AI Arena INFT (the CEO)
                          ├──▶ KULT compute layer   /v1/runs (the employees)
                          └──▶ Creator Studio       /api/internal/kult-create/games (publish)
```

## How it works

1. **Entrance.** You need a studio to go in. The player connects a wallet and
   signs a one-time message (no gas, no transaction).
2. **Register the Agency.**
   - **OKX.ai identity**: an ERC-8004 agent ID on X Layer
     (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`). The signed-in wallets must
     include its owner or its agent wallet. One studio per identity.
   - **CEO**: the player's KULT agent INFT on 0G mainnet. One studio per agent;
     the CEO is never minted here.
   - A second wallet can be linked (for example, the OKX Agentic Wallet holds
     the identity and another wallet holds the INFT).
3. **Credits.** Every studio starts with **1,000 credits**. A **Pro** game
   costs **40** (compute tier 2), an **Ultra** game costs **100** (tier 3), and
   a change request costs **10**. Credits are debited atomically before the
   run starts and refunded automatically if the run fails or cannot start.
4. **The office.** Each pipeline step is owned by an employee:

   | Employee | Steps |
   |---|---|
   | Pip, Producer | `brief`, `edit-plan` |
   | Juno, Game Designer | `design` |
   | Vera, Art Director | `art`, `sprites`, `assets`, `edit-sprites` |
   | Mako, Illustrator | `keyart`, `sprite:*` |
   | Sol, Background Artist | `environment` |
   | Rio, Marketing | `cover`, `copy` |
   | Byte, Engineer | `code`, `code-edit` |
   | Quill, QA Engineer | `qa` |
   | Dash, Playtester | `playtest` |
   | Ledger, Publisher | `package` |
   | The CEO (your agent) | `approve-style` |

   The server polls the compute run and turns every status change into an
   office event, with lines written from each step's real output (for
   example "Design locked: 'Neon Space Rush', 6 characters and objects").
   Events are persisted, so reopening the office replays the timeline.
5. **Publish.** The finished game plays in the office. **Publish** asks
   Creator Studio to import the run (art copied to its storage, 0G provenance,
   the same publish steps as a normal game) under the studio's wallet.

## Run locally

```bash
npm install
cp .env.example .env     # set COMPUTE_LAYER_URL / COMPUTE_LAYER_KEY
npm run dev              # http://localhost:4300/office/
npm test
```

`/office/?demo=1` runs the whole office offline with a scripted production,
with no wallet or server calls. It is useful for demos and design work.

## Embedding in Kult World (Privy)

Kult World players are already signed in with Privy, so they walk into the
building signed in. Kult World loads `/embed.js` and passes the player's
Privy tokens to the office; Kult Create verifies them with the Privy app's
verification key (the same check creator-studio uses) and trusts every EVM
wallet Privy has linked to the player, including the Privy embedded wallet
that AI Arena binds their agent to.

```tsx
// In Kult World (React + @privy-io/react-auth)
import { getAccessToken, getIdentityToken, usePrivy } from "@privy-io/react-auth";

// <script src="https://YOUR-KULT-CREATE-HOST/embed.js"></script> in index.html,
// or load it once before calling KultCreate.open.
export function useKultCreateBuilding() {
  const { login, authenticated } = usePrivy();
  return () => window.KultCreate.open({
    getSession: async () => (authenticated
      ? { accessToken: await getAccessToken(), identityToken: await getIdentityToken() }
      : null),
    login: async () => login(),           // the office asks for this when signed out
    onExit: () => {/* back to the world map */},
  });
}
// After the player logs in/out while the office is open:
//   window.KultCreate.sessionChanged(isSignedIn)
```

Requirements:
- `PRIVY_APP_ID` / `PRIVY_VERIFICATION_KEY` must belong to the **same Privy
  app** Kult World and AI Arena use; otherwise the player's wallets will not
  match their AI Arena agent.
- Enable **identity tokens** in the Privy dashboard (creator-studio already
  relies on them). Without them, set `PRIVY_APP_SECRET` so the user can be
  looked up from the access token.
- Set `ALLOWED_ORIGINS` to Kult World's origin: it controls who may frame the
  office and whose session messages the office accepts.

Message protocol (`embed.js` implements the parent side):

| Direction | Message |
|---|---|
| office → Kult World | `{ type: "kultcreate:ready" }` (send me the session) |
| office → Kult World | `{ type: "kultcreate:login" }` (player pressed sign in) |
| Kult World → office | `{ type: "kultcreate:session", accessToken, identityToken }` |
| Kult World → office | `{ type: "kultcreate:logout" }` |
| office → Kult World | `{ type: "kultcreate:exit" }` |

Opened outside Kult World, the office falls back to a wallet signature
(OKX Wallet, MetaMask or any injected wallet).

## API

All `/agency*` routes need `Authorization: Bearer <token>` from `/auth/verify`.
The SSE route also accepts `?token=`.

| Method | Path | |
|---|---|---|
| GET | `/health`, `/config` | status; costs, modes, employee roster |
| POST | `/auth/challenge` | `{ address, purpose? }` → `{ nonce, message }` |
| POST | `/auth/verify` | `{ nonce, signature }` → `{ token, wallets, hasAgency }` |
| POST | `/auth/privy` | `{ accessToken?, identityToken }` → `{ token, wallets, hasAgency }` (Kult World) |
| POST | `/auth/link` | link another wallet (challenge with `purpose: "link"`) |
| GET | `/me` | wallets and agency |
| GET | `/identity/okx/:agentId` | Agent Card from X Layer |
| GET | `/ceo/candidates` | the signed-in wallets' KULT agent INFTs |
| POST | `/agency` | `{ name, tagline?, okxAgentId, ceoTokenId, ceoName? }` |
| GET | `/agency`, `/ledger` | studio, recent productions, credit history |
| POST | `/agency/productions` | `{ brief, mode: "pro" \| "ultra" }` |
| GET | `/agency/productions/:id` | production with its timeline |
| GET | `/agency/productions/:id/events` | SSE: `snapshot`, `employee`, `progress`, `status` |
| POST | `/agency/productions/:id/edits` | `{ request }` (10 credits) |
| POST | `/agency/productions/:id/publish` | `{ publish?: true }` → Creator Studio |

## Deploy (Render)

`render.yaml` defines the service. Set:

- `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY`: the shared KULT Privy app.
- `AI_ARENA_DATABASE_URL`: AI Arena's Postgres, used for the CEO check. Use a read-only role.
- `MONGODB_URI`: required in production. It can be the creator-studio cluster; data goes in the `kult_create` database.
- `COMPUTE_LAYER_KEY`: the compute layer's `COMPUTE_API_KEY`.
- `CREATOR_STUDIO_KEY`: the same value as `KULT_CREATE_SERVICE_KEY` on creator-studio.
- `PUBLIC_URL` and `ALLOWED_ORIGINS`.

On creator-studio, set `KULT_CREATE_SERVICE_KEY` (and optionally
`CREATOR_STUDIO_PUBLIC_URL` for full play links).

## Verification switches

`OKX_IDENTITY_VERIFY=off` skips the ownership check; the agent must still exist
on X Layer.

**CEO (AI Arena INFT, `0xA8A5a1D6AA3BF4575f6a1031966C8079BD4e9b9b`).** AI Arena
mints every agent to its custodian wallet (`0x043091b1…F46db`), so `ownerOf`
never names the player. A wallet proves control of an agent if it owns the
token, or if it was granted ERC-7857 usage (`hasValidUsage(tokenId, wallet)`).
`CEO_INFT_VERIFY` modes:

| Mode | Accepts |
|---|---|
| `arena` (default when `AI_ARENA_DATABASE_URL` is set) | AI Arena's Postgres binds the agent to the signed-in wallet (`User.walletAddress` → `Agent.inftTokenId`, retired agents excluded), **and** the contract's `agentIdToTokenId(agentId)` returns the same token. The player picks from their own agents. |
| `strict` | Only the owner, or a wallet with usage rights |
| `custodial` (default without a database) | `strict`, plus any agent still held by the custodian. The agent must exist, but nothing proves the player owns it, and the first studio to claim it wins. |
| `off` | Any token ID, with no chain read (tests only) |

In every mode, owning the INFT or holding ERC-7857 usage rights also counts.
Players must sign in to Kult Create with the wallet they use for AI Arena (or
link it). Connect with a read-only Postgres role: kult-create only runs
`SELECT`s on `"User"` and `"Agent"`, inside read-only transactions.
