const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const Sim = require("../shared/sim");
const Protocol = require("../shared/protocol");
const PORT = Number(process.env.PORT || 3000);
const root = path.join(__dirname, "..", "client");
const server = http.createServer((req, res) => {
  const url = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const full = path.normalize(url.startsWith("/shared/") ? path.join(__dirname, "..", "shared", url.slice(8)) : path.join(root, url));
  if (!full.startsWith(root) && !full.startsWith(path.join(__dirname, "..", "shared"))) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(full);
    res.writeHead(200, { "Content-Type": ({".html":"text/html",".js":"text/javascript",".css":"text/css"}[ext] || "application/octet-stream") });
    res.end(data);
  });
});
const wss = new WebSocket.Server({ server });
let nextId = 1;
const world = { tick: 0, ships: [], bullets: [] };
const peers = new Map();
function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(data); }
wss.on("connection", ws => {
  const id = nextId++;
  const ship = Sim.createShip(id, (0x9e3779b9 ^ id) >>> 0, 180 + id * 90, 180 + id * 60);
  world.ships.push(ship);
  peers.set(ws, { id, ship, lastSeq: 0, inputs: [], json: false });
  send(ws, JSON.stringify({ type: "welcome", id, tickRate: 30 }));
  ws.on("message", (data, isBinary) => {
    const peer = peers.get(ws); if (!peer) return;
    if (!isBinary) {
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === "mode") peer.json = !!msg.json;
      else if (msg.type === "chat" && typeof msg.text === "string") {
        const text = msg.text.slice(0, 240);
        for (const client of peers.keys()) send(client, JSON.stringify({ type: "chat", id: peer.id, text }));
      }
      else if (msg.type === "input") peer.inputs.push({ seq: msg.seq >>> 0, throttle: msg.throttle || 0, turn: msg.turn || 0, fire: !!msg.fire });
    } else {
      const input = Protocol.decodeInput(data);
      if (input) peer.inputs.push(input);
    }
  });
  ws.on("close", () => {
    const peer = peers.get(ws); peers.delete(ws);
    if (peer) world.ships = world.ships.filter(s => s.id !== peer.id);
  });
});
const inputs = {};
function step() {
  const byId = {};
  for (const peer of peers.values()) {
    const input = peer.inputs.shift();
    if (input) { byId[peer.id] = input; peer.lastSeq = input.seq; }
    else byId[peer.id] = { throttle: 0, turn: 0, fire: false };
  }
  Sim.stepWorld(world, byId, Sim.DT);
  for (const [ws, peer] of peers) {
    if (peer.json) send(ws, JSON.stringify({ type: "snapshot", tick: world.tick, ack: peer.lastSeq, ships: world.ships }));
    else send(ws, Protocol.encodeSnapshot(world, peer.lastSeq));
  }
}
// Target-time scheduler: no setInterval; corrects drift against monotonic process.hrtime.
const period = 1e9 / 30;
let target = process.hrtime.bigint() + BigInt(Math.round(period));
function loop() {
  const now = process.hrtime.bigint();
  if (now >= target) {
    step();
    target += BigInt(Math.round(period));
    if (now - target > BigInt(period * 4)) target = now + BigInt(Math.round(period));
  }
  const remaining = Number(target - process.hrtime.bigint()) / 1e6;
  setTimeout(loop, Math.max(0, Math.min(remaining, 5)));
}
server.listen(PORT, () => { console.log(`Lab 5 server: http://localhost:${PORT}`); loop(); });