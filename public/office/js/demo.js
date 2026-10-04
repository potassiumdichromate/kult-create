// Offline stand-in for the API (?demo=1): a registered studio and a scripted
// production, so the office can be shown without a wallet or a server.

const EMPLOYEES = [
  { id: "ceo", title: "CEO", name: null, color: "#f2c14e" },
  { id: "producer", title: "Producer", name: "Pip", color: "#ff7eb6" },
  { id: "designer", title: "Game Designer", name: "Juno", color: "#7ee081" },
  { id: "artdirector", title: "Art Director", name: "Vera", color: "#c792ea" },
  { id: "illustrator", title: "Illustrator", name: "Mako", color: "#ff9f5a" },
  { id: "background", title: "Background Artist", name: "Sol", color: "#5ec8f2" },
  { id: "marketing", title: "Marketing", name: "Rio", color: "#ffd166" },
  { id: "engineer", title: "Engineer", name: "Byte", color: "#4dd4ac" },
  { id: "qa", title: "QA Engineer", name: "Quill", color: "#f78c6b" },
  { id: "playtester", title: "Playtester", name: "Dash", color: "#9fa8ff" },
  { id: "publisher", title: "Publisher", name: "Ledger", color: "#e8e8e8" }
];

// Little procedural pixel pictures standing in for generated art.
function picture(kind, hue) {
  const c = document.createElement("canvas");
  c.width = 32; c.height = 32;
  const g = c.getContext("2d");
  if (kind === "scene") {
    const grad = g.createLinearGradient(0, 0, 0, 32); grad.addColorStop(0, `hsl(${hue},70%,55%)`); grad.addColorStop(1, `hsl(${hue + 40},60%,25%)`);
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    g.fillStyle = `hsl(${hue + 120},40%,30%)`; g.fillRect(0, 24, 32, 8);
    g.fillStyle = "#fff"; g.fillRect(24, 5, 4, 4);
  } else {
    g.fillStyle = `hsl(${hue},75%,55%)`; g.fillRect(9, 8, 14, 18); g.fillRect(7, 12, 18, 10);
    g.fillStyle = `hsl(${hue},75%,35%)`; g.fillRect(19, 8, 4, 18);
    g.fillStyle = "#fff"; g.fillRect(12, 13, 3, 3); g.fillRect(18, 13, 3, 3);
    g.fillStyle = "#111"; g.fillRect(13, 14, 2, 2); g.fillRect(19, 14, 2, 2);
  }
  return c.toDataURL();
}

const DEMO_GAME = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#120c2a;overflow:hidden;font-family:'Press Start 2P',monospace;color:#fff}canvas{display:block;width:100%;height:100%}</style><canvas id=c></canvas><script>
const c=document.getElementById('c'),g=c.getContext('2d');let W,H;function rs(){W=c.width=innerWidth;H=c.height=innerHeight}rs();onresize=rs;
let p={x:0.5,y:0.8},items=[],score=0,t=0,over=false;
onpointermove=e=>p.x=e.clientX/W;onpointerdown=e=>{p.x=e.clientX/W;if(over){over=false;score=0;items=[]}};
function f(){t++;g.fillStyle='#120c2a';g.fillRect(0,0,W,H);for(let i=0;i<40;i++){g.fillStyle='#2a2155';g.fillRect((i*97)%W,(i*53+t)%H,2,2)}
if(!over&&t%30==0)items.push({x:Math.random(),y:-0.05,bad:Math.random()<0.3});
for(const it of items){it.y+=0.006;g.fillStyle=it.bad?'#f78c6b':'#7ee081';g.fillRect(it.x*W-10,it.y*H-10,20,20);
if(!over&&Math.abs(it.x-p.x)<0.08&&Math.abs(it.y-p.y)<0.04){it.y=2;if(it.bad)over=true;else score++}}
items=items.filter(i=>i.y<1.1);g.fillStyle='#ffd166';g.fillRect(p.x*W-24,p.y*H-8,48,16);
g.fillStyle='#fff';g.font='16px monospace';g.fillText('SCORE '+score,16,32);if(over){g.textAlign='center';g.fillText('GAME OVER - TAP',W/2,H/2);g.textAlign='left'}
requestAnimationFrame(f)}f();<\/script>`;

export function createDemoApi() {
  let credits = 1000;
  const agency = {
    id: "agy_demo", name: "Pixel Pirates", tagline: "Tiny games, big hearts",
    okxAgentId: "2170", okx: { name: "Pixel Pirates (OKX.ai)", verified: true, owner: "0xdemo" },
    ceoTokenId: "42", ceo: { tokenId: "42", name: "Captain Nova", image: null, verified: true },
    ownerWallets: ["0xdemo"], credits, gamesMade: 0, gamesPublished: 0
  };
  const productions = new Map();
  let n = 0;

  const script = (brief, kind) => {
    const hue = (brief.length * 37) % 360;
    const title = brief.split(/\s+/).slice(0, 3).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ") || "Demo Game";
    const E = (employee, nodeId, state, line, image) => ({ type: "employee", employee, nodeId, state, line, image: image || null });
    if (kind === "edit") {
      return [
        [600, E("producer", "edit-plan", "working", "Reading the change request…")],
        [2000, E("producer", "edit-plan", "done", `Change plan: ${brief.slice(0, 60)}`)],
        [2400, E("engineer", "code-edit", "working", "Applying the change to the code…")],
        [5200, E("engineer", "code-edit", "done", "Updated 38 lines of game code.")],
        [5500, E("qa", "qa", "working", "Running the acceptance tests…")],
        [7000, E("qa", "qa", "done", "All acceptance tests passed.")],
        [7300, E("playtester", "playtest", "working", "Playtesting it on a phone…")],
        [9200, E("playtester", "playtest", "done", "Playtest passed. Visuals 8/10, readability 9/10.")],
        [9500, E("publisher", "package", "working", "Packaging the build…")],
        [10400, E("publisher", "package", "done", "Build packaged and ready. Over to you, boss!")]
      ];
    }
    const sprites = ["player", "coin", "enemy", "power up"];
    const ev = [
      [500, E("producer", "brief", "working", "Reading the brief and picking the genre…")],
      [2200, E("producer", "brief", "done", `This is an arcade game in neon style. Working title: "${title}".`)],
      [2500, E("designer", "design", "working", "Drafting the game design document…")],
      [5000, E("designer", "design", "done", `Design locked: "${title}" — 6 characters and objects, 4 difficulty steps.`)],
      [5200, E("artdirector", "art", "working", "Choosing the art style and the sprite list…")],
      [5300, E("marketing", "copy", "working", "Writing the store listing…")],
      [5400, E("engineer", "code", "working", "Writing the game code…")],
      [7000, E("artdirector", "art", "done", `Neon Arcade style. Sprites to draw: ${sprites.join(", ")}.`)],
      [7300, E("illustrator", "keyart", "working", "Drawing the hero character first…")],
      [7600, E("marketing", "copy", "done", `${title}: dodge, collect and chase the high score.`)],
      [10200, E("illustrator", "keyart", "done", "Finished the hero.", picture("sprite", hue))],
      [10400, E("ceo", "approve-style", "done", "Key art approved.")],
      [10600, E("background", "environment", "working", "Painting the background scene…")],
      [10700, E("marketing", "cover", "working", "Painting the cover art…")],
      [10800, E("artdirector", "sprites", "done", "Assigned 3 sprites to Mako.")]
    ];
    let t = 11000;
    for (const [i, s] of sprites.slice(1).entries()) {
      ev.push([t, E("illustrator", `sprite:${s}`, "working", `Drawing ${s}…`)]);
      ev.push([t + 2200, E("illustrator", `sprite:${s}`, "done", `Finished ${s}.`, picture("sprite", hue + 60 * (i + 1)))]);
      t += 2400;
    }
    ev.push([13000, E("engineer", "code", "done", "Wrote 412 lines of game code.")]);
    ev.push([13300, E("qa", "qa", "working", "Running the acceptance tests…")]);
    ev.push([14500, E("background", "environment", "done", "Background scene painted.", picture("scene", hue))]);
    ev.push([15200, E("marketing", "cover", "done", "Cover art is ready.", picture("scene", hue + 180))]);
    ev.push([16800, E("qa", "qa", "done", "All acceptance tests passed after 1 fix.")]);
    ev.push([t + 200, E("artdirector", "assets", "working", "Packing the art for the engineer…")]);
    ev.push([t + 900, E("artdirector", "assets", "done", "Art pack ready: 5 images.")]);
    ev.push([t + 1100, E("playtester", "playtest", "working", "Playtesting it on a phone…")]);
    ev.push([t + 4200, E("playtester", "playtest", "done", "Playtest passed. Visuals 8/10, readability 9/10.")]);
    ev.push([t + 4400, E("publisher", "package", "working", "Packaging the build…")]);
    ev.push([t + 5400, E("publisher", "package", "done", "Build packaged and ready. Over to you, boss!")]);
    return ev.sort((a, b) => a[0] - b[0]);
  };

  const make = (kind, brief, mode, cost, parentId) => {
    if (credits < cost) throw Object.assign(new Error(`Not enough credits: this needs ${cost}, the studio has ${credits}.`), { status: 402 });
    credits -= cost; agency.credits = credits;
    const id = `prd_demo${++n}`;
    const p = { id, kind, parentId, mode, brief, cost, status: "running", result: null, published: null, timeline: [], createdAt: Date.now(), events: script(brief, kind) };
    productions.set(id, p);
    return { production: { ...p, events: undefined }, credits };
  };

  return {
    demo: true,
    hasSession: () => true,
    signOut() {},
    config: async () => ({ credits: { starting: 1000, pro: 40, ultra: 100, edit: 10 }, modes: { pro: { label: "Pro", cost: 40 }, ultra: { label: "Ultra", cost: 100 } }, employees: EMPLOYEES }),
    signIn: async () => ({ wallets: ["0xdemo"], hasAgency: true }),
    linkWallet: async () => ({ wallets: ["0xdemo"] }),
    me: async () => ({ wallets: ["0xdemo"], agency: { ...agency } }),
    agency: async () => ({ agency: { ...agency }, productions: [...productions.values()].reverse().map((p) => ({ ...p, events: undefined })) }),
    okx: async (id) => ({ agentId: id, name: `OKX.ai Agent #${id}`, owner: "0xdemo", taken: false }),
    candidates: async () => ({ candidates: [] }),
    register: async () => ({ agency }),
    ledger: async () => ({ entries: [] }),
    topGames: async () => ({ games: [
      { rank: 1, id: "t1", title: "Neon Drift", plays: 1840, likes: 212, comments: 48, shares: 31, studio: { name: "Arcade Owls" }, playUrl: null },
      { rank: 2, id: "t2", title: "Carrot Kingdom", plays: 1203, likes: 150, comments: 22, shares: 12, studio: { name: "Farmhouse Games" }, playUrl: null },
      ...[...productions.values()].filter((p) => p.status === "complete" && p.kind === "build").map((p, i) => ({ rank: 3 + i, id: p.id, title: p.result.title, thumbnailUrl: p.result.coverUrl, plays: 120, likes: 18, comments: 6, shares: 3, studio: { name: agency.name }, mine: true, playUrl: p.result.playUrl }))
    ] }),
    dashboard: async (range) => {
      const games = [...productions.values()].filter((p) => p.kind === "build").map((p, i) => ({
        id: p.id, latestId: p.id, title: p.result?.title || p.brief.slice(0, 40), coverUrl: p.result?.coverUrl || null, mode: p.mode,
        status: p.status, versions: p.status === "complete" ? 1 : 0, changes: 0, creditsSpent: p.cost, createdAt: p.createdAt,
        published: p.published, stats: { plays: 120 - i * 30, likes: 18 - i * 4, comments: 6, shares: 3, remixes: 1, earned: 240, kpEarned: 60 },
        recentComments: [{ id: "c" + i, username: "pixelfan", text: "The boss fight is so good!" }]
      }));
      const points = Array.from({ length: 7 }, (_, i) => ({ label: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i], plays: [3, 8, 5, 14, 22, 18, 30][i], games: i === 6 ? games.length : 0, timeSeconds: [60, 300, 200, 900, 1500, 1200, 2400][i], earned: [5, 20, 10, 40, 60, 50, 80][i] }));
      const team = EMPLOYEES.filter((e) => e.id !== "ceo").map((e, i) => ({ ...e, done: (games.length || 1) * (3 + (i % 4)), errors: i === 7 ? 1 : 0 }));
      const spent = 1000 - credits;
      return {
        studio: { ...agency, credits }, engagement: "ok", series: { range, points }, games, team,
        totals: { plays: games.reduce((s, g) => s + g.stats.plays, 0), likes: 42, comments: 12, shares: 6, remixes: 2, earned: 480, kultPoints: 120, games: games.filter((g) => g.versions).length, published: 0, productions: productions.size, creditsLeft: credits, creditsSpent: spent, creditsRefunded: 0 },
        ledger: [...productions.values()].reverse().map((p) => ({ at: p.createdAt, delta: -p.cost, reason: p.kind === "edit" ? "Game change" : `${p.mode === "ultra" ? "Ultra" : "Pro"} game` })).concat([{ at: Date.now() - 864e5, delta: 1000, reason: "Studio grant" }])
      };
    },
    linkOkx: async (id) => { agency.okxAgentId = id; agency.okx = { name: `OKX.ai Agent #${id}`, verified: true }; return { agency: { ...agency } }; },
    start: async ({ brief, mode }) => make("build", brief, mode, mode === "ultra" ? 100 : 40, null),
    edit: async (id, request) => { const parent = productions.get(id); return make("edit", request, parent?.mode || "pro", 10, id); },
    production: async (id) => ({ production: { ...productions.get(id), events: undefined } }),
    publish: async () => ({ published: { gameId: "demo", status: "published", playUrl: null } }),
    subscribe(id, onEvent) {
      const p = productions.get(id);
      onEvent({ type: "snapshot", production: { ...p, events: undefined } });
      if (p.status !== "running") return () => {};
      const timers = p.events.map(([ms, e]) => setTimeout(() => { p.timeline.push(e); onEvent({ ...e, at: Date.now() }); }, ms));
      const end = p.events[p.events.length - 1][0] + 900;
      timers.push(setTimeout(() => {
        p.status = "complete";
        const playUrl = URL.createObjectURL(new Blob([DEMO_GAME], { type: "text/html" }));
        const art = p.events.find(([, e]) => e.nodeId === "cover" && e.image)?.[1].image;
        const parent = p.parentId ? productions.get(p.parentId) : null;
        p.result = { title: parent?.result?.title || p.brief.split(/\s+/).slice(0, 3).join(" "), playUrl, coverUrl: art || parent?.result?.coverUrl || null, quality: { acceptance: true, playtest: "passed" } };
        if (p.kind === "build") agency.gamesMade += 1;
        onEvent({ type: "status", status: "complete", result: p.result });
      }, end));
      return () => timers.forEach(clearTimeout);
    }
  };
}
