import { config, assertConfig } from "./config.js";
import { createStore } from "./store/index.js";
import { Productions } from "./productions.js";
import { createApp } from "./app.js";
import { closeArena } from "./arena.js";

const problems = assertConfig();
if (problems.length) {
  for (const p of problems) console.error(`[kult-create] config: ${p}`);
  process.exit(1);
}

const store = await createStore(config);
const productions = new Productions({ store });
const app = createApp({ store, productions });

const server = app.listen(config.port, async () => {
  const resumed = await productions.resume();
  console.log(`[kult-create] listening on ${config.publicUrl} (storage: ${store.kind}, compute: ${config.computeLayer.url}${resumed ? `, resumed ${resumed} production(s)` : ""})`);
  if (config.inft.mode === "off") console.warn("[kult-create] CEO_INFT_VERIFY=off: CEO agents are not checked on-chain");
  if (config.inft.mode === "arena") console.log("[kult-create] CEO check: AI Arena database + 0G INFT contract");
  if (config.inft.mode === "custodial") console.warn("[kult-create] CEO_INFT_VERIFY=custodial: agents still held by the AI Arena custodian are accepted without proof of ownership");
  if (!config.okx.verify) console.warn("[kult-create] OKX_IDENTITY_VERIFY=off: OKX.ai identity ownership is not checked");
});

const shutdown = async () => {
  productions.stopAll();
  server.close();
  await store.close();
  await closeArena();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
