// Shared deterministic simulation: no DOM, Node APIs, Date.now() or Math.random().
(function (root) {
  "use strict";
  const DT = 1 / 30;
  const WORLD_W = 1200, WORLD_H = 700;
  const TURN_RATE = 2.8, ACCEL = 220, DRAG = 0.985, MAX_SPEED = 300;
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function createShip(id, seed, x, y) {
    return { id, x, y, vx: 0, vy: 0, angle: (seed % 6283) / 1000, hp: 100, seed: seed >>> 0 };
  }
  // Deterministic PRNG. State is kept per ship and is initialized by the server.
  function random01(ship) {
    let x = ship.seed >>> 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    ship.seed = x >>> 0;
    return ship.seed / 4294967296;
  }
  function integrate(ship, input, dt, tick) {
    input = input || {};
    const throttle = clamp(Number(input.throttle) || 0, -1, 1);
    const turn = clamp(Number(input.turn) || 0, -1, 1);
    ship.angle += turn * TURN_RATE * dt;
    ship.vx += Math.cos(ship.angle) * throttle * ACCEL * dt;
    ship.vy += Math.sin(ship.angle) * throttle * ACCEL * dt;
    ship.vx *= DRAG; ship.vy *= DRAG;
    const speed = Math.hypot(ship.vx, ship.vy);
    if (speed > MAX_SPEED) { ship.vx = ship.vx / speed * MAX_SPEED; ship.vy = ship.vy / speed * MAX_SPEED; }
    ship.x = (ship.x + ship.vx * dt + WORLD_W) % WORLD_W;
    ship.y = (ship.y + ship.vy * dt + WORLD_H) % WORLD_H;
    if (input.fire && tick % 9 === 0) {
      // Fire events are deterministic and the server remains authoritative.
      return { id: ship.id + ":b:" + tick, owner: ship.id, x: ship.x + Math.cos(ship.angle) * 20,
        y: ship.y + Math.sin(ship.angle) * 20, vx: Math.cos(ship.angle) * 420 + ship.vx,
        vy: Math.sin(ship.angle) * 420 + ship.vy, born: tick };
    }
    return null;
  }
  function stepWorld(world, inputs, dt) {
    world.tick++;
    const shots = [];
    world.ships.forEach(function (ship) {
      const shot = integrate(ship, inputs[ship.id], dt == null ? DT : dt, world.tick);
      if (shot) shots.push(shot);
    });
    world.bullets = (world.bullets || []).concat(shots);
    world.bullets.forEach(function (b) { b.x += b.vx * (dt == null ? DT : dt); b.y += b.vy * (dt == null ? DT : dt); });
    world.bullets = world.bullets.filter(function (b) {
      return world.tick - b.born < 70 && b.x >= 0 && b.x <= WORLD_W && b.y >= 0 && b.y <= WORLD_H;
    });
    return world;
  }
  const api = { DT, WORLD_W, WORLD_H, createShip, integrate, stepWorld };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GameSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this);