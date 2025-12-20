import { Snake } from "./Snake.js";
import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  FOOD_COUNT,
  POWERUP_COUNT,
  POWERUP_RESPAWN_MIN_MS,
  POWERUP_RESPAWN_MAX_MS,
  EFFECT,
} from "./Config.js";
import { Renderer } from "./Renderer.js";
import { PowerUpManager, PowerUpType } from "./PowerUps.js";

export class MultiplayerGame {
  constructor({ mode, canvas, scoreElement, players, hostClientId, onBroadcastState, onEnd }) {
    this.mode = mode;
    this.canvas = canvas;
    this.scoreElement = scoreElement;

    this.cols = GRID_COLS;
    this.rows = GRID_ROWS;
    this.cellSize = CELL_SIZE;

    this.renderer = new Renderer(this.canvas, this.cols, this.rows, this.cellSize);

    this.players = players;
    this.hostClientId = hostClientId;

    this.onBroadcastState = onBroadcastState;
    this.onEnd = onEnd;

    this.isRunning = false;
    this.lastTime = null;

    this.baseMoveDuration = 120;

    this.foods = [];
    this.powerUps = new PowerUpManager({
      cols: this.cols,
      rows: this.rows,
      maxCount: POWERUP_COUNT,
      respawnMinMs: POWERUP_RESPAWN_MIN_MS,
      respawnMaxMs: POWERUP_RESPAWN_MAX_MS,
    });

    // host
    this.snakes = new Map();
    this.pendingKeys = new Map();
    this.tickId = 0;

    // ✅ HOST: throttle network snapshots (critical for smooth joiner)
    this.broadcastIntervalMs = 50; // 20/s
    this._lastBroadcastAt = 0;
    this._stateDirty = false;

    // ✅ CLIENT: jitter buffer
    this._buf = []; // [{ state, t }]
    this._maxBuf = 10;

    this._avgArrival = 80;
    this._lastRecvAt = 0;

    this.renderDelayMs = 120;
    this._minDelay = 70;
    this._maxDelay = 220;
  }

  start() {
    this.isRunning = true;
    this.lastTime = performance.now();

    if (this.mode === "host") {
      this._lastBroadcastAt = 0;
      this._stateDirty = false;
      this.resetHostWorld();
    } else {
      this._buf.length = 0;
      this._avgArrival = 80;
      this._lastRecvAt = 0;
      this.renderDelayMs = 120;
    }

    requestAnimationFrame(this.loop.bind(this));
  }

  stop() {
    this.isRunning = false;
  }

  applyRemoteInput(clientId, key) {
    if (this.mode !== "host") return;
    this.pendingKeys.set(clientId, key);
  }

  // ✅ recvAt comes from controller (accurate timing)
  applyRemoteState(state, recvAt = performance.now()) {
    if (this.mode !== "client") return;
    if (!state || typeof state !== "object") return;
    if (typeof state.tickId !== "number") return;

    const last = this._buf[this._buf.length - 1]?.state;
    if (last && state.tickId <= last.tickId) return;

    // arrival EMA
    if (this._lastRecvAt) {
      const dt = recvAt - this._lastRecvAt;
      const clamped = Math.max(15, Math.min(350, dt));
      this._avgArrival = this._avgArrival * 0.85 + clamped * 0.15;
    }
    this._lastRecvAt = recvAt;

    const targetDelay = Math.max(this._minDelay, Math.min(this._maxDelay, this._avgArrival * 1.6));
    this.renderDelayMs = this.renderDelayMs * 0.9 + targetDelay * 0.1;

    this._buf.push({ state, t: recvAt });
    if (this._buf.length > this._maxBuf) {
      this._buf.splice(0, this._buf.length - this._maxBuf);
    }
  }

  loop(t) {
    if (!this.isRunning) return;

    const delta = t - (this.lastTime ?? t);
    this.lastTime = t;

    if (this.mode === "host") {
      for (const entry of this.snakes.values()) entry.effects.update(t);
      this.powerUps.update(t);

      for (const entry of this.snakes.values()) {
        if (!entry.alive) continue;

        const mult = this.getSpeedMultiplier(entry);
        const dur = Math.max(40, this.baseMoveDuration / mult);

        entry.moveDuration = dur;
        entry.moveProgress = (entry.moveProgress ?? 0) + delta / dur;
      }

      let safety = 0;
      while (this.anySnakeReadyToStep() && safety++ < 10) {
        const stepIds = [];
        for (const [cid, entry] of this.snakes.entries()) {
          if (entry.alive && (entry.moveProgress ?? 0) >= 1) stepIds.push(cid);
        }
        this.tickHost(t, stepIds);
      }

      // render host smooth
      this.renderer.render(this.buildHostInterpolatedRenderState());

      // ✅ throttle outgoing state
      this.maybeBroadcast(t);
    } else {
      this.renderer.render(this.buildClientBufferedRenderState());
    }

    requestAnimationFrame(this.loop.bind(this));
  }

  // ================= HOST =================

  resetHostWorld() {
    this.foods = [];
    this.snakes.clear();
    this.pendingKeys.clear();
    this.tickId = 0;

    const ids = Array.from(this.players.keys()).sort();
    const spawns = this.makeSpawnPoints(ids.length);

    for (let i = 0; i < ids.length; i++) {
      const cid = ids[i];
      const spawn = spawns[i];

      const dirs = [
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: -1 },
      ];

      const snake = new Snake(spawn.x, spawn.y, { startDirection: dirs[i % dirs.length] });

      this.snakes.set(cid, {
        snake,
        score: 0,
        alive: true,
        effects: new PowerUpManager({ cols: this.cols, rows: this.rows, maxCount: 0, respawnMinMs: 0, respawnMaxMs: 0 }),
        moveDuration: this.baseMoveDuration,
        moveProgress: 0,
        lastSegments: snake.segments.map((s) => ({ ...s })),
      });
    }

    for (let i = 0; i < FOOD_COUNT; i++) this.spawnFoodHost();

    this.powerUps.reset();
    this.powerUps.initSpawn((x, y) => this.isCellBlockedHost(x, y));

    this._stateDirty = true;
    this.forceBroadcast(performance.now());
  }

  makeSpawnPoints(n) {
    const m = 4;
    const pts = [
      { x: m, y: m },
      { x: this.cols - 1 - m, y: m },
      { x: m, y: this.rows - 1 - m },
      { x: this.cols - 1 - m, y: this.rows - 1 - m },
    ];
    return Array.from({ length: n }, (_, i) => pts[i] ?? pts[0]);
  }

  getSpeedMultiplier(entry) {
    let mult = 1;
    if (entry.effects.isActive(PowerUpType.SPEED)) mult *= EFFECT.SPEED_MULT;
    if (entry.effects.isActive(PowerUpType.SLOW)) mult *= EFFECT.SLOW_MULT;
    return mult;
  }

  anySnakeReadyToStep() {
    for (const entry of this.snakes.values()) {
      if (entry.alive && (entry.moveProgress ?? 0) >= 1) return true;
    }
    return false;
  }

  tickHost(now, stepIds = null) {
    this.tickId += 1;

    // apply input
    for (const [cid, key] of this.pendingKeys.entries()) {
      const entry = this.snakes.get(cid);
      if (!entry?.alive) continue;

      const s = entry.snake;
      if (key === "ArrowUp") s.setDirection(0, -1);
      else if (key === "ArrowDown") s.setDirection(0, 1);
      else if (key === "ArrowLeft") s.setDirection(-1, 0);
      else if (key === "ArrowRight") s.setDirection(1, 0);
    }
    this.pendingKeys.clear();

    // snapshot pre-move
    const stepSet = stepIds ? new Set(stepIds) : null;
    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;
      if (stepSet && !stepSet.has(cid)) continue;
      entry.lastSegments = entry.snake.segments.map((s) => ({ ...s }));
    }

    // move
    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;
      if (stepSet && !stepSet.has(cid)) continue;

      entry.snake.step();
      entry.moveProgress = Math.max(0, Number(entry.moveProgress ?? 0) - 1);
    }

    // collisions + pickups
    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;

      const head = entry.snake.segments[0];

      if (head.x < 0 || head.x >= this.cols || head.y < 0 || head.y >= this.rows) {
        entry.alive = false;
        continue;
      }

      const ghost = entry.effects.isActive(PowerUpType.GHOST);
      if (!ghost) {
        for (let i = 1; i < entry.snake.segments.length; i++) {
          const seg = entry.snake.segments[i];
          if (seg.x === head.x && seg.y === head.y) {
            entry.alive = false;
            break;
          }
        }
        if (!entry.alive) continue;
      }

      if (!ghost) {
        for (const [oid, other] of this.snakes.entries()) {
          if (!other.alive) continue;

          const segs = other.snake.segments;
          const start = oid === cid ? 1 : 0;
          for (let i = start; i < segs.length; i++) {
            const seg = segs[i];
            if (seg.x === head.x && seg.y === head.y) {
              entry.alive = false;
              break;
            }
          }
          if (!entry.alive) break;
        }
        if (!entry.alive) continue;
      }

      const picked = this.powerUps.collectAt(head.x, head.y);
      if (picked) {
        if (picked.type === PowerUpType.SPEED) entry.effects.activate(PowerUpType.SPEED, now, EFFECT.SPEED_MS);
        else if (picked.type === PowerUpType.SLOW) {
          for (const [oid, oe] of this.snakes.entries()) {
            if (oid !== cid) oe.effects.activate(PowerUpType.SLOW, now, EFFECT.SLOW_MS);
          }
        } else if (picked.type === PowerUpType.GHOST) entry.effects.activate(PowerUpType.GHOST, now, EFFECT.GHOST_MS);
        else if (picked.type === PowerUpType.SHRINK) entry.snake.shrink(EFFECT.SHRINK_AMOUNT, EFFECT.MIN_SNAKE_LEN);

        this.powerUps.ensureSpawn((x, y) => this.isCellBlockedHost(x, y));
      }

      const idx = this.foods.findIndex((f) => f.x === head.x && f.y === head.y);
      if (idx !== -1) {
        entry.snake.grow();
        entry.score += 10;
        this.foods.splice(idx, 1);
        this.spawnFoodHost();
      }

      entry.effects.update(now);
    }

    this._stateDirty = true;

    const aliveCount = Array.from(this.snakes.values()).filter((e) => e.alive).length;
    if (aliveCount <= 1) this.endGameHost();
  }

  maybeBroadcast(now) {
    if (!this.onBroadcastState) return;
    if (!this._stateDirty) return;

    if (!this._lastBroadcastAt || now - this._lastBroadcastAt >= this.broadcastIntervalMs) {
      this._lastBroadcastAt = now;
      this._stateDirty = false;
      this.onBroadcastState(this.buildTickState());
    }
  }

  forceBroadcast(now) {
    if (!this.onBroadcastState) return;
    this._lastBroadcastAt = now;
    this._stateDirty = false;
    this.onBroadcastState(this.buildTickState());
  }

  buildTickState() {
    const snakes = [];
    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;

      const slot = this.players.get(cid)?.slot ?? 1;
      const c = colorsForSlot(slot);

      snakes.push({
        clientId: cid,
        segments: entry.snake.segments.map((s) => ({ x: s.x, y: s.y })),
        mpColorBody: c.body,
        mpColorGlow: c.glow,
      });
    }

    const scores = Array.from(this.snakes.entries()).map(([cid, e]) => ({
      clientId: cid,
      name: this.players.get(cid)?.name ?? cid,
      score: e.score ?? 0,
      alive: !!e.alive,
      slot: this.players.get(cid)?.slot ?? 1,
    }));

    return {
      tickId: this.tickId,
      snakes,
      foods: this.foods,
      powerUps: this.powerUps.powerUps,
      scores,
    };
  }

  buildHostInterpolatedRenderState() {
    const snakes = [];

    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;

      const slot = this.players.get(cid)?.slot ?? 1;
      const c = colorsForSlot(slot);

      const progress = Math.max(0, Math.min(1, Number(entry.moveProgress ?? 0)));

      const cur = entry.snake.segments;
      const last = entry.lastSegments ?? cur;

      const segs = cur.map((seg, i) => {
        const prev = last[i];
        if (!prev) return { x: seg.x, y: seg.y };
        return {
          x: prev.x + (seg.x - prev.x) * progress,
          y: prev.y + (seg.y - prev.y) * progress,
        };
      });

      snakes.push({ clientId: cid, segments: segs, mpColorBody: c.body, mpColorGlow: c.glow });
    }

    return {
      snakes,
      foods: this.foods,
      powerUps: this.powerUps.powerUps,
      scores: Array.from(this.snakes.entries()).map(([cid, e]) => ({
        clientId: cid,
        name: this.players.get(cid)?.name ?? cid,
        score: e.score ?? 0,
        alive: !!e.alive,
        slot: this.players.get(cid)?.slot ?? 1,
      })),
    };
  }

  spawnFoodHost() {
    for (let safety = 0; safety < 2000; safety++) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * this.rows);
      if (this.isCellBlockedHost(x, y)) continue;
      if (this.foods.some((f) => f.x === x && f.y === y)) continue;
      this.foods.push({ x, y });
      return;
    }
  }

  isCellBlockedHost(x, y) {
    for (const e of this.snakes.values()) {
      if (!e.alive) continue;
      if (e.snake.segments.some((s) => s.x === x && s.y === y)) return true;
    }
    if (this.foods.some((f) => f.x === x && f.y === y)) return true;
    if (this.powerUps.powerUps.some((p) => p.x === x && p.y === y)) return true;
    return false;
  }

  endGameHost() {
    this.isRunning = false;
    this.forceBroadcast(performance.now());

    const scores = Array.from(this.snakes.entries()).map(([cid, e]) => ({
      clientId: cid,
      name: this.players.get(cid)?.name ?? cid,
      score: e.score ?? 0,
    }));

    scores.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const winner = scores[0];

    this.onEnd?.({ winnerName: winner?.name ?? "Winner", scores });
  }

  // ================= CLIENT =================

  buildClientBufferedRenderState() {
    if (this._buf.length === 0) return { snakes: [], foods: [], powerUps: [], scores: [] };
    if (this._buf.length === 1) return this._buf[0].state;

    const now = performance.now();
    const renderTime = now - this.renderDelayMs;

    // find surrounding states
    let a = null;
    let b = null;

    for (let i = 0; i < this._buf.length - 1; i++) {
      const cur = this._buf[i];
      const next = this._buf[i + 1];
      if (cur.t <= renderTime && renderTime <= next.t) {
        a = cur;
        b = next;
        break;
      }
    }

    // fallback: last two
    if (!a || !b) {
      a = this._buf[this._buf.length - 2];
      b = this._buf[this._buf.length - 1];
    }

    const span = Math.max(1, b.t - a.t);
    let alpha = (renderTime - a.t) / span;
    alpha = Math.max(0, Math.min(1, alpha));

    const prevSnakes = new Map((a.state.snakes ?? []).map((s) => [s.clientId, s]));
    const currSnakes = new Map((b.state.snakes ?? []).map((s) => [s.clientId, s]));

    const snakes = [];
    for (const [cid, cur] of currSnakes.entries()) {
      const prev = prevSnakes.get(cid);
      if (!prev) {
        snakes.push(cur);
        continue;
      }

      const segs = (cur.segments ?? []).map((seg, i) => {
        const p = prev.segments?.[i];
        if (!p) return { x: seg.x, y: seg.y };
        return {
          x: p.x + (seg.x - p.x) * alpha,
          y: p.y + (seg.y - p.y) * alpha,
        };
      });

      snakes.push({ ...cur, segments: segs });
    }

    return {
      snakes,
      foods: b.state.foods ?? [],
      powerUps: b.state.powerUps ?? [],
      scores: b.state.scores ?? [],
    };
  }
}

function colorsForSlot(slot) {
  if (slot === 2) return { body: "rgba(255, 220, 60, 0.95)", glow: "rgba(255, 220, 60, 0.85)" };
  if (slot === 3) return { body: "rgba(80, 255, 80, 0.95)", glow: "rgba(80, 255, 80, 0.85)" };
  if (slot === 4) return { body: "rgba(255, 90, 90, 0.95)", glow: "rgba(255, 90, 90, 0.85)" };
  return { body: "rgba(200, 255, 255, 0.95)", glow: "rgba(0, 255, 255, 0.85)" };
}
