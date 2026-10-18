(() => {
"use strict";
const canvas = document.getElementById("game"), ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const keys = new Set(); let socket, myId = null, seq = 0, lastSnapshotAt = performance.now();
let authoritative = null, predicted = null, pending = [], remoteFrames = [], bytes = 0, bytesAt = performance.now();
let rtt = 0, correction = 0, lastPing = 0, jsonMode = false, bullets = [];
const history = [];
const inputState = () => ({ throttle: (keys.has("w") || keys.has("arrowup")) ? 1 : 0, turn: (keys.has("a") || keys.has("arrowleft") ? -1 : 0) + (keys.has("d") || keys.has("arrowright") ? 1 : 0), fire: keys.has(" ") });
addEventListener("keydown", e => { const k=e.key.toLowerCase(); keys.add(k); if([" ","arrowup","arrowleft","arrowright"].includes(k)) e.preventDefault(); });
addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
function connect() {
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
  socket.binaryType = "arraybuffer";
  socket.onopen = () => { statusEl.textContent = "Connected"; socket.send(JSON.stringify({type:"mode",json:jsonMode})); lastPing=performance.now(); };
  socket.onclose = () => { statusEl.textContent = "Disconnected — reload to reconnect"; };
  socket.onerror = () => { statusEl.textContent = "Connection error"; };
  socket.onmessage = ev => {
    bytes += typeof ev.data === "string" ? ev.data.length : ev.data.byteLength;
    if (typeof ev.data === "string") {
      let m; try { m=JSON.parse(ev.data); } catch { return; }
      if(m.type==="welcome"){myId=m.id; statusEl.textContent=`Connected as player ${myId}`; return;}
      if(m.type==="chat"){ addChat(`Player ${m.id}: ${m.text}`); return; }
      if(m.type==="snapshot") handleSnapshot(m);
    } else {
      const m=GameProtocol.decodeSnapshot(ev.data);
      if(m) handleSnapshot(m);
    }
  };
}
function handleSnapshot(s) {
  lastSnapshotAt=performance.now();
  if (lastPing) { rtt = performance.now()-lastPing; lastPing=performance.now(); }
  const mine=s.ships.find(x=>x.id===myId);
  remoteFrames.push({at:performance.now(), ships:s.ships});
  if(remoteFrames.length>20) remoteFrames.shift();
  if(!mine) return;
  authoritative={...mine}; const old=predicted ? Math.hypot(predicted.x-mine.x,predicted.y-mine.y) : 0;
  correction=old;
  pending=pending.filter(i=>i.seq>s.ack);
  predicted={...mine};
  pending.forEach(i=>GameSim.integrate(predicted,i,GameSim.DT,s.tick+1));
}
function sendInput() {
  if(!socket || socket.readyState!==WebSocket.OPEN || myId===null) return;
  const input={seq:++seq,...inputState()};
  pending.push(input); if(pending.length>120) pending.shift();
  if(jsonMode) socket.send(JSON.stringify({type:"input",...input}));
  else socket.send(GameProtocol.encodeInput(input));
}
document.getElementById("jsonMode").addEventListener("change", e=>{
  jsonMode=e.target.checked;
  if(socket?.readyState===WebSocket.OPEN) socket.send(JSON.stringify({type:"mode",json:jsonMode}));
});
document.getElementById("chatForm").addEventListener("submit",e=>{
  e.preventDefault();const input=document.getElementById("chatText");const text=input.value.trim();
  if(text&&socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify({type:"chat",text}));input.value="";}
});
function addChat(text){const el=document.createElement("div");el.textContent=text;document.getElementById("messages").append(el);el.scrollIntoView();}
let lastFrame=performance.now(), accumulator=0, lastInput=0;
function frame(now) {
  const elapsed=Math.min((now-lastFrame)/1000,.1);lastFrame=now;accumulator+=elapsed;
  while(accumulator>=GameSim.DT){sendInput();if(predicted)GameSim.integrate(predicted,inputState(),GameSim.DT,seq);accumulator-=GameSim.DT;}
  // Smooth correction over ~100 ms without delaying local controls.
  if(predicted&&authoritative){const a=Math.min(1,elapsed/.1);predicted.x+=((authoritative.x-predicted.x+GameSim.WORLD_W/2)%GameSim.WORLD_W-GameSim.WORLD_W/2)*a*.12;predicted.y+=((authoritative.y-predicted.y+GameSim.WORLD_H/2)%GameSim.WORLD_H-GameSim.WORLD_H/2)*a*.12;}
  draw(now);
  if(now-bytesAt>=1000){document.getElementById("bps").textContent=bytes;bytes=0;bytesAt=now;}
  document.getElementById("rtt").textContent=`${Math.round(rtt)} ms`;
  document.getElementById("age").textContent=`${Math.round(now-lastSnapshotAt)} ms`;
  document.getElementById("queue").textContent=pending.length;
  document.getElementById("correction").textContent=correction.toFixed(1);
  requestAnimationFrame(frame);
}
function drawShip(s,color,isMine=false) {
  ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.angle);ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(18,0);ctx.lineTo(-12,-10);ctx.lineTo(-7,0);ctx.lineTo(-12,10);ctx.closePath();ctx.stroke();
  if(isMine){ctx.beginPath();ctx.arc(0,0,24,0,Math.PI*2);ctx.strokeStyle="#5c83ff";ctx.lineWidth=1;ctx.stroke();}
  ctx.restore();
}
function draw(now) {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle="#1c2a45";ctx.lineWidth=1;
  for(let x=0;x<canvas.width;x+=50){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
  for(let y=0;y<canvas.height;y+=50){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
  const frames=remoteFrames.filter(f=>f.at<=now-100);
  const remote=frames.length?frames[frames.length-1].ships:[];
  remote.forEach(s=>{if(s.id!==myId)drawShip(s,"#ffb454");});
  if(predicted)drawShip(predicted,"#70e1b5",true);
  ctx.fillStyle="#ffdf85";
  if(predicted&&keys.has(" ")) {ctx.beginPath();ctx.arc(predicted.x+Math.cos(predicted.angle)*25,predicted.y+Math.sin(predicted.angle)*25,4,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle="#a9b8d6";ctx.font="14px system-ui";ctx.fillText(`tick ${remoteFrames.length?Math.round(remoteFrames[remoteFrames.length-1].at):0} · interpolation 100 ms`,16,24);
}
connect();requestAnimationFrame(frame);
})();