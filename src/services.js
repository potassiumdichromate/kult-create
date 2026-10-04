import { config } from "./config.js";

// Clients for the two services this building runs on:
//   compute layer  — builds games with the multi-agent DAG
//   creator studio — stores and publishes finished games

async function call(base, key, keyHeader, method, path, body, serviceName) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", ...(key ? { [keyHeader]: key } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    throw Object.assign(new Error(`${serviceName} is unreachable right now. Try again in a minute.`), { status: 503, upstream: true, cause: error });
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw Object.assign(new Error(data.error || `${method} ${path} failed (${res.status})`), { status: res.status >= 500 ? 502 : res.status, upstream: true });
  return data;
}

const compute = (method, path, body) => call(config.computeLayer.url, config.computeLayer.key, "x-compute-key", method, path, body, "The studio pipeline");
const studio = (method, path, body) => call(config.creatorStudio.url, config.creatorStudio.key, "x-kult-create-key", method, path, body, "Creator Studio");

export const computeLayer = {
  build: ({ prompt, tier, gameId }) => compute("POST", "/v1/runs", { prompt, tier, gameId }),
  edit: ({ parentRunId, request, tier }) => compute("POST", `/v1/runs/${encodeURIComponent(parentRunId)}/edits`, { request, tier }),
  run: (runId, outputs = false) => compute("GET", `/v1/runs/${encodeURIComponent(runId)}${outputs ? "?outputs=1" : ""}`),
  health: () => compute("GET", "/health")
};

export const creatorStudio = {
  // Imports the finished compute-layer run as a game owned by the studio's
  // wallet (art copied to R2, 0G provenance) and optionally publishes it.
  importRun: ({ runId, creatorWallet, studio: studioInfo, publish, gameId }) =>
    studio("POST", "/api/internal/kult-create/games", { runId, creatorWallet, studio: studioInfo, publish, gameId })
};
