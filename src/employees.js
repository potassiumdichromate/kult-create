// The office staff. Every compute-layer pipeline step is owned by one employee;
// the CEO is the studio's own 0G INFT agent. The office front end renders
// this roster and animates it from the events produced below.

export const EMPLOYEES = [
  { id: "ceo", title: "CEO", name: null, desk: "ceo", color: "#f2c14e" },
  { id: "producer", title: "Producer", name: "Pip", desk: "producer", color: "#ff7eb6" },
  { id: "designer", title: "Game Designer", name: "Juno", desk: "designer", color: "#7ee081" },
  { id: "artdirector", title: "Art Director", name: "Vera", desk: "artdirector", color: "#c792ea" },
  { id: "illustrator", title: "Illustrator", name: "Mako", desk: "illustrator", color: "#ff9f5a" },
  { id: "background", title: "Background Artist", name: "Sol", desk: "background", color: "#5ec8f2" },
  { id: "marketing", title: "Marketing", name: "Rio", desk: "marketing", color: "#ffd166" },
  { id: "engineer", title: "Engineer", name: "Byte", desk: "engineer", color: "#4dd4ac" },
  { id: "qa", title: "QA Engineer", name: "Quill", desk: "qa", color: "#f78c6b" },
  { id: "playtester", title: "Playtester", name: "Dash", desk: "playtester", color: "#9fa8ff" },
  { id: "publisher", title: "Publisher", name: "Ledger", desk: "publisher", color: "#e8e8e8" }
];

const OWNER = {
  brief: "producer", "edit-plan": "producer",
  design: "designer",
  art: "artdirector", sprites: "artdirector", "edit-sprites": "artdirector", assets: "artdirector",
  "approve-style": "ceo",
  keyart: "illustrator",
  environment: "background",
  cover: "marketing", copy: "marketing",
  code: "engineer", "code-edit": "engineer",
  qa: "qa",
  playtest: "playtester",
  package: "publisher"
};

export function ownerOf(nodeId) {
  if (nodeId.startsWith("sprite:")) return "illustrator";
  return OWNER[nodeId] ?? "producer";
}

const spriteName = (nodeId) => nodeId.slice(7).replace(/_/g, " ");
const clip = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ""));

const START = {
  brief: "Reading the brief and picking the genre…",
  design: "Drafting the game design document…",
  art: "Choosing the art style and the sprite list…",
  "approve-style": "Reviewing the key art…",
  keyart: "Drawing the hero character first…",
  sprites: "Handing out sprite assignments…",
  environment: "Painting the background scene…",
  cover: "Painting the cover art…",
  copy: "Writing the store listing…",
  assets: "Packing the art for the engineer…",
  code: "Writing the game code…",
  qa: "Running the acceptance tests…",
  playtest: "Playtesting it on a phone…",
  package: "Packaging the build…",
  "edit-plan": "Reading the change request…",
  "edit-sprites": "Working out which art needs to change…",
  "code-edit": "Applying the change to the code…"
};

export function startLine(nodeId) {
  if (nodeId.startsWith("sprite:")) return `Drawing ${spriteName(nodeId)}…`;
  return START[nodeId] ?? "On it…";
}

// The line an employee says when their step finishes, from that step's real output.
export function doneLine(node, output) {
  const id = node.id, o = output || {};
  if (node.status === "failed" || node.status === "blocked") return { line: `Ran into a problem: ${clip(node.error || "unknown error", 110)}` };
  const fallback = node.status === "degraded" ? " (used a safe fallback)" : "";
  if (id.startsWith("sprite:") || id === "keyart") {
    if (o.failed) return { line: `Couldn't draw ${spriteName(id) || "the hero"} — the game will use a shape for it.` };
    if (o.skipped) return { line: "No sprites in this tier." };
    return { line: `Finished ${id === "keyart" ? "the hero" : spriteName(id)}.`, image: o.url || null };
  }
  switch (id) {
    case "brief": {
      const genre = o.genre || o.recipe || "new";
      return { line: `This is ${/^[aeiou]/i.test(genre) ? "an" : "a"} ${genre} game in ${o.style || "our"} style. Working title: "${clip(o.title, 40)}".${fallback}` };
    }
    case "design": {
      const steps = (o.progression || []).length;
      return { line: `Design locked: "${clip(o.title, 40)}" — ${(o.entities || []).length} characters and objects${steps ? `, ${steps} difficulty steps` : ""}.${fallback}` };
    }
    case "art": {
      const names = (o.catalog || []).map((c) => c.name.replace(/_/g, " "));
      return { line: `${o.style?.name || "House"} style. Sprites to draw: ${clip(names.join(", "), 90) || "none"}.${fallback}` };
    }
    case "approve-style": return { line: o.auto ? "Key art approved." : o.feedback ? `Notes for the artists: ${clip(o.feedback, 90)}` : "Looks great. Carry on!" };
    case "sprites": return { line: `Assigned ${(o.names || []).length} sprites to Mako.` };
    case "environment": return o.skipped ? { line: "No painted background in this tier." } : o.failed ? { line: "The background didn't come out — we'll use the stylised one." } : { line: "Background scene painted.", image: o.url || null };
    case "cover": return { line: "Cover art is ready.", image: o.url || null };
    case "copy": return { line: clip(o.description || "Store listing written.", 120) };
    case "assets": return { line: `Art pack ready: ${o.count ?? 0} images${o.missing?.length ? `, ${o.missing.length} missing` : ""}.` };
    case "code":
    case "code-edit": {
      const lines = String(o.code || "").split("\n").length;
      return { line: o.source === "unchanged" ? "No code changes needed." : `Wrote ${lines} lines of game code${o.source === "recipe-fallback" ? " (used our tested template)" : ""}.` };
    }
    case "qa": {
      const r = o.report || {};
      const repairs = Math.max(0, (o.history?.length ?? 1) - 1);
      if (o.source === "recipe-fallback" || o.source === "edit-reverted") return { line: "The new code failed our tests, so I shipped the last version that works." };
      return { line: r.ok ? `All acceptance tests passed${repairs ? ` after ${repairs} fix${repairs > 1 ? "es" : ""}` : ""}.` : `Tests found issues: ${clip((r.failures || []).join("; "), 100)}` };
    }
    case "playtest": {
      if (o.skipped) return { line: "No phone browser available, so I skipped the visual playtest." };
      const v = o.afterVerdict || o.verdict;
      const s = v?.scores ? ` Visuals ${v.scores.visuals}/10, readability ${v.scores.readability}/10.` : "";
      const label = { passed: "Playtest passed.", fixed: "Found a problem in playtest and fixed it.", "fix-reverted": "Playtest found a problem; the fix wasn't better, so we kept the original.", failed: "Playtest found problems." }[o.status] || "Playtest done.";
      return { line: `${label}${s}`, image: o.screenshots?.[o.screenshots.length - 1]?.url || null };
    }
    case "package": return { line: "Build packaged and ready. Over to you, boss!" };
    case "edit-plan": return { line: clip(o.summary || "Change plan ready.", 120) };
    case "edit-sprites": return { line: (o.targets || []).length ? `Redrawing: ${o.targets.map((t) => t.name).join(", ")}.` : "No art changes needed." };
    default: return { line: `Done${fallback}.` };
  }
}
