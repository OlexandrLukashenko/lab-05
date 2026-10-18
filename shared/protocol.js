// Versioned binary protocol. All multi-byte fields are little-endian.
(function (root) {
  "use strict";
  const VERSION = 1, INPUT = 1, SNAPSHOT = 2;
  function encodeInput(input) {
    const b = new ArrayBuffer(10), v = new DataView(b);
    v.setUint8(0, VERSION); v.setUint8(1, INPUT);
    v.setUint32(2, input.seq >>> 0, true);
    v.setInt8(6, Math.max(-1, Math.min(1, input.throttle || 0)) * 127);
    v.setInt8(7, Math.max(-1, Math.min(1, input.turn || 0)) * 127);
    v.setUint8(8, input.fire ? 1 : 0); v.setUint8(9, 0);
    return b;
  }
  function decodeInput(buffer) {
    const v = new DataView(buffer);
    if (v.byteLength !== 10 || v.getUint8(0) !== VERSION || v.getUint8(1) !== INPUT) return null;
    return { seq: v.getUint32(2, true), throttle: v.getInt8(6) / 127, turn: v.getInt8(7) / 127, fire: !!v.getUint8(8) };
  }
  // Header: version/type/tick/ack/count; ship: id(16), x/y/vx/vy(float32), angle(int16), hp(uint8).
  function encodeSnapshot(world, ackSeq, ids) {
    const ships = world.ships, bullets = world.bullets || [];
    const size = 10 + ships.length * 33 + bullets.length * 24;
    const b = new ArrayBuffer(size), v = new DataView(b);
    v.setUint8(0, VERSION); v.setUint8(1, SNAPSHOT); v.setUint32(2, world.tick >>> 0, true);
    v.setUint32(6, ackSeq >>> 0, true);
    let o = 10;
    ships.forEach(s => {
      v.setUint8(o++, s.id & 255);
      v.setFloat32(o, s.x, true); o += 4; v.setFloat32(o, s.y, true); o += 4;
      v.setFloat32(o, s.vx, true); o += 4; v.setFloat32(o, s.vy, true); o += 4;
      v.setInt16(o, Math.round((((s.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 32767), true); o += 2;
      v.setUint8(o++, s.hp);
      // Keep fixed-size ship record (33 bytes) for forward-compatible extension.
      while (o % 33 !== 10) v.setUint8(o++, 0);
    });
    // Variable bullets are intentionally omitted from this first protocol revision.
    return b.slice(0, o);
  }
  function decodeSnapshot(buffer) {
    const v = new DataView(buffer);
    if (v.byteLength < 10 || v.getUint8(0) !== VERSION || v.getUint8(1) !== SNAPSHOT) return null;
    const tick = v.getUint32(2, true), ack = v.getUint32(6, true), ships = [];
    let o = 10;
    while (o + 19 <= v.byteLength) {
      const id = v.getUint8(o++), x = v.getFloat32(o, true); o += 4, y = v.getFloat32(o, true); o += 4;
      const vx = v.getFloat32(o, true); o += 4, vy = v.getFloat32(o, true); o += 4;
      const angle = v.getInt16(o, true) / 32767 * Math.PI * 2; o += 2;
      const hp = v.getUint8(o++);
      ships.push({ id, x, y, vx, vy, angle, hp });
      // records are 19 bytes in this compact version
    }
    return { tick, ack, ships };
  }
  root.GameProtocol = { VERSION, encodeInput, decodeInput, encodeSnapshot, decodeSnapshot };
  if (typeof module !== "undefined" && module.exports) module.exports = root.GameProtocol;
})(typeof globalThis !== "undefined" ? globalThis : this);