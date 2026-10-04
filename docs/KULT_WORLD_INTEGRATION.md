# Kult Create × Kult World: integration guide

This document has everything needed to put the **Kult Create** building into
**Kult World**: what it is, how it works, what the Kult World side has to do,
configuration, testing and troubleshooting. It is written so a developer, or an
AI coding agent, can follow it from top to bottom without other context.

> **Using an AI agent?** Give it this file plus access to the Kult World repo
> and say: *"Follow docs/KULT_WORLD_INTEGRATION.md and add the Kult Create
> building to Kult World."* The task is in [§6](#6-the-integration-task-kult-world-side).

---

## 1. What Kult Create is

Kult Create is the **game-studio building** in Kult World.

- A player walks their avatar into the building. If they don't have a studio
  yet, they register one: a **studio name**, a **tagline**, and their own **KULT
  agent** (their AI Arena INFT on 0G) becomes the studio's **CEO**.
- Inside is an isometric pixel-art **office**. The CEO writes a game brief and
  ten AI employees (Producer, Game Designer, Art Director, Illustrator,
  Background Artist, Marketing, Engineer, QA, Playtester, Publisher) build the
  game live. They are the KULT compute layer's agents, and each pipeline step is
  shown as that employee working at their desk.
- The finished game plays inside the office. The CEO can request changes, and
  **publish** it to Kult Creator Studio.
- Every studio starts with **1,000 credits**: a **Pro** game costs **40**, an
  **Ultra** game **100**, a change request **10**. Failed builds are refunded.
- A CEO-only **Dashboard** shows plays, likes, comments, shares, remixes,
  Creator Score, KULT points, a chart over time, the studio's games, comments
  and the team's output. **Games** lists the top games across all studios and
  **Credits** shows the balance.
- Linking an **OKX.ai identity** (ERC-8004 on X Layer) is **optional**: only for
  studios used commercially, which then become discoverable to OKX users and
  agentic tasks on OKX's Onchain OS.

Kult World only has to **open the office** and **hand over the player's Privy
session**. Everything else lives in Kult Create.

## 2. Live services

| Service | URL | Repo | Role |
|---|---|---|---|
| **Kult Create** | https://kult-create.onrender.com | `potassiumdichromate/kult-create` | Office UI (`/office/`), embed script (`/embed.js`), studios, credits, productions |
| KULT compute layer | https://kult-compute-layer.onrender.com | `potassiumdichromate/0g-ComputeLayer` | Builds games with the multi-agent pipeline |
| Creator Studio (backend) | https://creator-studio-pi5b.onrender.com | `potassiumdichromate/creator-studio` | Stores and publishes games; engagement numbers |
| AI Arena Postgres | (private) | `0g-AIArena` | Which player owns which agent (read-only) |
| 0G mainnet | chain 16661 | — | AI Arena INFT contract `0xA8A5a1D6AA3BF4575f6a1031966C8079BD4e9b9b` |
| X Layer | chain 196 | — | ERC-8004 IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (OKX.ai, optional) |

Useful links:
- Office: https://kult-create.onrender.com/office/
- Offline demo (no login, scripted game): https://kult-create.onrender.com/office/?demo=1
- Health: https://kult-create.onrender.com/health. Every field should read `ok`, and `verify.ceoInft` should be `arena`.

## 3. How it fits together

```
Kult World page (React + Privy)
  │  loads https://kult-create.onrender.com/embed.js
  │  KultCreate.open({ getSession, login, onExit })
  ▼
┌──────────── full-screen iframe: /office/?embed=1 ────────────┐
│ office → parent  "kultcreate:ready"                          │
│ parent → office  "kultcreate:session" {accessToken, idToken} │
│ office → server  POST /auth/privy  → Kult Create session     │
│ office → server  GET /ceo/candidates (AI Arena DB + 0G)      │
│ … register studio, write briefs, watch the team, publish …   │
│ office → parent  "kultcreate:exit"  → iframe removed         │
└──────────────────────────────────────────────────────────────┘
        │                     │                       │
        ▼                     ▼                       ▼
  compute layer        Creator Studio            AI Arena Postgres
  (/v1/runs)           (/api/internal/           + 0G INFT contract
                        kult-create/*)             (CEO ownership)
```

### Sign-in (Privy)

- Kult World, AI Arena and Creator Studio all use **the same Privy app**, and
  Kult Create verifies tokens from that app (`PRIVY_APP_ID`).
- Kult World passes the player's **access token** and **identity token**. Kult
  Create verifies both with the Privy verification key, the same check Creator
  Studio's backend does, and trusts **every EVM wallet** Privy has linked to
  the player, including the Privy embedded wallet.
- The office then uses its own session token (7 days). No secret leaves Kult
  World except the player's own short-lived Privy tokens.
- Opened directly (not inside Kult World), the office shows the same Privy
  login modal as Creator Studio. Inside Kult World it never shows its own login.

### Who can be CEO

- AI Arena binds each agent to the player's wallet in its Postgres
  (`User.walletAddress` → `Agent.inftTokenId`, retired agents excluded).
- AI Arena mints every INFT to its own custodian wallet, so on-chain
  `ownerOf` never names the player. Kult Create therefore checks both:
  1. **Database:** the agent belongs to one of the player's Privy wallets.
  2. **Chain:** the INFT contract's `agentIdToTokenId(agentId)` returns the same
     token.
- One studio per agent. A player with **no agent** sees "You need an agent
  first", with a link to AI Arena (`AI_ARENA_APP_URL`, default
  `https://app.kult.games`).

### Player journey

1. The avatar enters the building, and Kult World calls `KultCreate.open(...)`.
2. The office asks for the session, and Kult World sends the Privy tokens.
3. The office continues based on the player's account:
   - **Has a studio:** straight into the office.
   - **Has an agent, no studio:** **Register your studio** (name, tagline,
     optional OKX.ai). The CEO is picked automatically.
   - **No agent:** "You need an agent first", with a link to AI Arena.
4. **Exit building** sends `kultcreate:exit`, and Kult World removes the iframe and
   resumes the world.

## 4. The embed API (`/embed.js`)

Served by Kult Create; it implements the Kult World side of the protocol.

```html
<script src="https://kult-create.onrender.com/embed.js"></script>
```

```ts
window.KultCreate.open({
  // Required. Resolve to the player's current Privy tokens, or null if signed out.
  getSession: () => Promise<{ accessToken?: string; identityToken?: string } | null>,
  // Optional. Called when the office needs a signed-in player (opens Privy login).
  login?: () => Promise<void>,
  // Optional. Called after the player leaves the building (iframe already removed).
  onExit?: () => void,
  // Optional. Element to mount the iframe in (default: document.body, full screen).
  container?: HTMLElement,
}): HTMLIFrameElement;

window.KultCreate.close();                    // remove the office programmatically
window.KultCreate.sessionChanged(signedIn);   // call after Privy login/logout while open
```

Behaviour:
- `open()` adds a full-screen iframe (`position:fixed; inset:0; z-index:2147483000`)
  pointing at `/office/?embed=1`. Calling it again while open returns the same
  iframe.
- It only answers messages from that iframe at the Kult Create origin, and only
  sends the session to that origin.
- `sessionChanged(false)` signs the office out. `sessionChanged(true)` sends the
  new session.

### Message protocol (if you don't use `embed.js`)

| Direction | Message | Meaning |
|---|---|---|
| office → Kult World | `{ type: "kultcreate:ready" }` | Send me the player's session (on load) |
| office → Kult World | `{ type: "kultcreate:login" }` | Player pressed "Sign in with Kult World" |
| Kult World → office | `{ type: "kultcreate:session", accessToken, identityToken }` | The Privy tokens |
| Kult World → office | `{ type: "kultcreate:logout" }` | Player signed out of Kult World |
| office → Kult World | `{ type: "kultcreate:exit" }` | Player pressed Exit building |

The office ignores session messages from origins that aren't in Kult Create's
`ALLOWED_ORIGINS`. If no session arrives within 3 seconds, it shows its entrance
with a "Sign in with Kult World" button.

## 5. Configuration

### Kult Create (Render service `kult-create`)

| Variable | Value | Notes |
|---|---|---|
| `ALLOWED_ORIGINS` | **Kult World's exact origin**, e.g. `https://world.kult.games` | Comma-separated. Controls who may frame the office (CSP `frame-ancestors`) **and** whose session messages it accepts. Must match the browser's address bar exactly: scheme, host and port, with no trailing slash. |
| `PRIVY_APP_ID` | the shared KULT Privy app ID | Same app as Kult World / AI Arena / Creator Studio |
| `PRIVY_VERIFICATION_KEY` | Privy dashboard → App settings → Verification key | With or without the `BEGIN PUBLIC KEY` lines |
| `PRIVY_APP_SECRET` | optional | Only needed if Kult World sends no identity token |
| `PRIVY_CLIENT_ID` | optional | Privy client ID, used for the standalone login |
| `AI_ARENA_DATABASE_URL` | AI Arena Postgres, **read-only role** | Only `SELECT`s on `"User"` and `"Agent"` |
| `CEO_INFT_VERIFY` | `arena` | Other modes: `strict`, `custodial`, `off` (tests only) |
| `AI_ARENA_APP_URL` | `https://app.kult.games` | Link for players without an agent |
| `MONGODB_URI` | Mongo cluster | Required in production (database `kult_create`) |
| `SESSION_SECRET` | random | Generated by `render.yaml` |
| `PUBLIC_URL` | `https://kult-create.onrender.com` | |
| `COMPUTE_LAYER_URL` / `COMPUTE_LAYER_KEY` | compute layer URL / its `COMPUTE_API_KEY` | |
| `CREATOR_STUDIO_URL` / `CREATOR_STUDIO_KEY` | Creator Studio backend / shared secret | Key must equal Creator Studio's `KULT_CREATE_SERVICE_KEY` |
| `OKX_IDENTITY_VERIFY` | `on` | Ownership check for optional OKX.ai linking |
| `STARTING_CREDITS`, `CREDIT_COST_PRO`, `CREDIT_COST_ULTRA`, `CREDIT_COST_EDIT` | 1000 / 40 / 100 / 10 | Economy |

Build command on Render: `npm install --include=dev --no-audit --no-fund && npm run build`.
It builds the Privy login bundle used when the office is opened directly.

### Creator Studio backend

| Variable | Value |
|---|---|
| `KULT_CREATE_SERVICE_KEY` | Same value as Kult Create's `CREATOR_STUDIO_KEY` |
| `CREATOR_STUDIO_PUBLIC_URL` | Optional: the Creator Studio frontend URL, for "View on Creator Studio" links |

### Kult World

| Item | Value |
|---|---|
| Script | `https://kult-create.onrender.com/embed.js` |
| Privy | Identity tokens enabled in the Privy dashboard (Creator Studio already relies on them) |
| CSP, if Kult World sets one | `script-src` must allow `https://kult-create.onrender.com`; `frame-src` must allow `https://kult-create.onrender.com` |

### Privy dashboard

- Kult World's domain must already be an allowed origin (it is, if Privy login
  works there).
- `https://kult-create.onrender.com` must be an allowed origin for the
  standalone office login. It is already configured; the modal opens.

## 6. The integration task (Kult World side)

**Goal:** when the player's avatar enters the Kult Create building, open the
office signed in as that player; when they leave, return to the world.

### Step 1: Load the embed script once

In the HTML shell (`index.html`) or with a loader when the world boots:

```html
<script src="https://kult-create.onrender.com/embed.js" defer></script>
```

Or load it on demand:

```ts
function loadKultCreate(): Promise<void> {
  if ((window as any).KultCreate) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://kult-create.onrender.com/embed.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Kult Create is unavailable"));
    document.head.appendChild(s);
  });
}
```

### Step 2: Add a hook that opens the building with the Privy session

Use the same Privy functions Creator Studio's frontend uses
(`creator-studio-frontend-tg/src/lib/api.ts`):

```tsx
import { getAccessToken, getIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useCallback } from "react";

declare global {
  interface Window {
    KultCreate?: {
      open(o: {
        getSession: () => Promise<{ accessToken?: string; identityToken?: string } | null>;
        login?: () => Promise<void>;
        onExit?: () => void;
        container?: HTMLElement;
      }): HTMLIFrameElement;
      close(): void;
      sessionChanged(signedIn: boolean): void;
    };
  }
}

export function useKultCreateBuilding({ onExit }: { onExit?: () => void } = {}) {
  const { authenticated, login } = usePrivy();

  return useCallback(async () => {
    await loadKultCreate();                       // from Step 1, or skip if the <script> tag is in index.html
    window.KultCreate!.open({
      getSession: async () => {
        if (!authenticated) return null;
        const [accessToken, identityToken] = await Promise.all([getAccessToken(), getIdentityToken()]);
        return { accessToken: accessToken ?? undefined, identityToken: identityToken ?? undefined };
      },
      login: async () => { login(); },            // office asked for a signed-in player; Step 4 sends the session once Privy finishes
      onExit,                                     // resume the world here
    });
  }, [authenticated, login, onExit]);
}
```

### Step 3: Trigger it from the building

Wherever Kult World handles "avatar entered a building" (map trigger, door
click, collision with the building tile, or a UI button):

```tsx
const enterKultCreate = useKultCreateBuilding({
  onExit: () => {
    world.resume();          // un-pause input, camera, audio
    avatar.stepOutOfDoor();  // optional: place the avatar outside the door
  },
});

function onBuildingEnter(buildingId: string) {
  if (buildingId !== "kult-create") return;
  world.pause();             // stop world input/audio while the office is open
  enterKultCreate();
}
```

### Step 4: Keep the session in sync

Required. Privy's `login()` returns as soon as its modal opens, so this effect is
what delivers the session after a player signs in from inside the office. It
also signs the office out when the player logs out of Kult World:

```tsx
const { authenticated } = usePrivy();
useEffect(() => { window.KultCreate?.sessionChanged(authenticated); }, [authenticated]);
```

### Step 5: Configure origins

1. Set Kult Create's `ALLOWED_ORIGINS` to Kult World's exact origin(s),
   including staging and local development if needed, e.g.
   `https://world.kult.games,http://localhost:5173`. Then redeploy Kult Create.
2. If Kult World has a Content-Security-Policy, allow
   `https://kult-create.onrender.com` in `script-src` and `frame-src`.

### Done when

- [ ] Entering the building opens the office full screen, already signed in.
- [ ] A player with an AI Arena agent and no studio sees **Register your
      studio** with their agent as CEO; after registering they have 1,000 credits.
- [ ] A returning player goes straight into their office.
- [ ] A player without an agent sees **You need an agent first**.
- [ ] **Exit building** closes the office and the world resumes.
- [ ] Logging out of Kult World while inside signs the office out.
- [ ] Works on a phone. The office has its own mobile layout with a bottom tab bar.

## 7. Testing

**Without Kult World:**
1. Open https://kult-create.onrender.com/office/?demo=1. This is the full office
   offline, with a scripted production, dashboard, games and credits.
2. Open https://kult-create.onrender.com/office/ and sign in with Privy, using
   the same account as AI Arena.

**With a local Kult World:** add your dev origin (for example
`http://localhost:5173`) to `ALLOWED_ORIGINS`, then enter the building.

**Minimal parent page** (to test the handoff with real Privy tokens): any page
on an allowed origin that already has Privy can do:

```js
KultCreate.open({ getSession: async () => ({ accessToken: await getAccessToken(), identityToken: await getIdentityToken() }) });
```

**Server checks:**
- `GET /health`: `computeLayer`, `aiArenaDb` and `storage` must all be healthy.
- `GET /config`: `privy: true`, and `embedOrigins` lists Kult World's origin.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Iframe is blank / "refused to connect" | Kult World's origin not in `ALLOWED_ORIGINS` (CSP `frame-ancestors`) | Add the exact origin, redeploy Kult Create |
| Office shows its entrance instead of signing in | Session message ignored (origin mismatch) or `getSession` returned null | Check `ALLOWED_ORIGINS`; check the player is `authenticated` in Privy |
| "Your Kult World session could not be verified" | Tokens from a different Privy app, or expired | Use the shared Privy app; `getAccessToken()` refreshes tokens |
| "Send the Privy identity token (or set PRIVY_APP_SECRET)" | Only an access token was sent | Enable identity tokens in Privy, or set `PRIVY_APP_SECRET` |
| "You need an agent first" for a player who has one | Their AI Arena agent is on a different Privy wallet, or the INFT isn't minted yet (`inftTokenId` empty) | Check `User.walletAddress` / `Agent.inftTokenId` in AI Arena |
| "AI Arena agent … does not match INFT #N on 0G" | Database row and `agentIdToTokenId` disagree | Fix the AI Arena record |
| Dashboard: "Plays, likes and comments are unavailable" | Creator Studio unreachable or key mismatch | `CREATOR_STUDIO_KEY` must equal `KULT_CREATE_SERVICE_KEY` |
| Publish fails | Same as above | Same as above |
| Builds fail immediately (credits refunded) | Compute layer down or `COMPUTE_LAYER_KEY` wrong | Check https://kult-compute-layer.onrender.com/health |
| Old UI after a deploy | Browser cache from before the no-cache fix | Hard refresh (Ctrl/Cmd + Shift + R) once |

## 9. Kult Create API (reference)

All `/agency*`, `/me`, `/ceo/*` and `/games/*` routes need
`Authorization: Bearer <token>` from `/auth/privy` (or `/auth/verify`). The
production event stream also accepts `?token=`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health`, `/config` | Status; costs, employees, Privy app ID, allowed origins |
| POST | `/auth/privy` | `{ accessToken?, identityToken }` → `{ token, wallets, hasAgency }` |
| POST | `/auth/challenge`, `/auth/verify`, `/auth/link` | Wallet-signature sign-in / link a wallet (fallback) |
| GET | `/me` | Wallets and studio |
| GET | `/ceo/candidates` | The player's KULT agents |
| GET | `/identity/okx/:agentId` | OKX.ai Agent Card from X Layer |
| POST | `/agency` | `{ name, tagline?, okxAgentId?, ceoTokenId? }` |
| POST | `/agency/okx` | Link an OKX.ai identity later |
| GET | `/agency` | Studio and recent productions |
| GET | `/agency/dashboard?range=day\|week\|month\|year` | CEO dashboard data |
| GET | `/games/top` | Top games across all studios |
| GET | `/ledger` | Credit history |
| POST | `/agency/productions` | `{ brief, mode: "pro" \| "ultra" }` |
| GET | `/agency/productions/:id` | Production with its timeline |
| GET | `/agency/productions/:id/events` | Live office feed (SSE) |
| POST | `/agency/productions/:id/edits` | `{ request }` (10 credits) |
| POST | `/agency/productions/:id/publish` | Publish to Creator Studio |

Creator Studio internal routes used by Kult Create (header `x-kult-create-key`):
`POST /api/internal/kult-create/games`, `GET /api/internal/kult-create/dashboard`,
`GET /api/internal/kult-create/top-games`.

## 10. Security notes

- Kult World sends only the player's own Privy tokens, and only to the Kult
  Create origin (`embed.js` uses a fixed target origin).
- Kult Create verifies them server-side with Privy's verification key. A forged
  or foreign token is rejected, and a page can only sign in as its own player.
- The office accepts session messages only from `ALLOWED_ORIGINS`, and the same
  list controls who may frame it.
- The AI Arena database is read with a read-only role inside read-only
  transactions.
- Credits are debited atomically before a build starts, and never go below zero.

## 11. Known limits

- **Add credits** shows "coming soon": no payment flow yet.
- The dashboard's "Over time" plays and play-time chart counts every game made
  with the CEO's wallet, including games made directly in Creator Studio. The
  per-game rows and totals are limited to the studio's games.
- The ten employees are named characters (Pip, Juno, Vera, Mako, Sol, Rio,
  Byte, Quill, Dash, Ledger). Only the CEO is the player's own agent.
