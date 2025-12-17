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

    // host only
    // clientId -> { snake, score, alive, effects, lastSegments, moveProgress }
    this.snakes = new Map();
    this.pendingKeys = new Map();

    // network send throttling (host)
    this.tickId = 0;
    this.sendAccum = 0;
    this.sendIntervalMs = 50; // ~20 Hz

    // client smoothing between snapshots
    this.prevState = null;
    this.currState = null;
    this.lastRecvAt = 0;
    this.currRecvAt = 0;
    this.avgInterval = 60; // ms, adaptive
  }

  start() {
    this.isRunning = true;
    this.lastTime = performance.now();

    if (this.mode === "host") {
      this.resetHostWorld();
    }

    requestAnimationFrame(this.loop.bind(this));
  }

  stop() {
    this.isRunning = false;
  }

  // ================= INPUT =================

  applyRemoteInput(clientId, key) {
    if (this.mode !== "host") return;
    this.pendingKeys.set(clientId, key);
  }

  applyRemoteState(state) {
    if (this.mode !== "client") return;
    if (!state || typeof state !== "object") return;

    const now = performance.now();
    this.lastRecvAt = this.currRecvAt || now;
    this.currRecvAt = now;

    const interval = this.currRecvAt - this.lastRecvAt;
    if (interval > 5 && interval < 500) {
      // EMA för stabil interpolation även om nätet jitterar
      this.avgInterval = this.avgInterval * 0.85 + interval * 0.15;
    }

    this.prevState = this.currState;
    this.currState = state;
  }

  // ================= LOOP =================

  loop(t) {
    if (!this.isRunning) return;

    const delta = t - (this.lastTime ?? t);
    this.lastTime = t;

    if (this.mode === "host") {
      this.hostFrame(t, delta);
    } else {
      this.clientFrame();
    }

    requestAnimationFrame(this.loop.bind(this));
  }

  // ================= HOST =================

  resetHostWorld() {
    this.foods = [];
    this.snakes.clear();
    this.pendingKeys.clear();
    this.tickId = 0;
    this.sendAccum = 0;

    const ids = Array.from(this.players.keys()).sort();
    const spawns = this.makeSpawnPoints(ids.length);

    for (let i = 0; i < ids.length; i++) {
      const cid = ids[i];
      const spawn = spawns[i];

      const dirs = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ];

      const snake = new Snake(spawn.x, spawn.y, { startDirection: dirs[i % dirs.length] });

      this.snakes.set(cid, {
        snake,
        score: 0,
        alive: true,
        effects: new PowerUpManager({ cols: this.cols, rows: this.rows, maxCount: 0, respawnMinMs: 0, respawnMaxMs: 0 }),
        lastSegments: snake.segments.map((s) => ({ ...s })),
        moveProgress: 0,
      });
    }

    for (let i = 0; i < FOOD_COUNT; i++) this.spawnFoodHost();

    this.powerUps.reset();
    this.powerUps.initSpawn((x, y) => this.isCellBlockedHost(x, y));
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

  hostFrame(now, delta) {
    // uppdatera powerups + effekter
    this.powerUps.update(now);
    for (const e of this.snakes.values()) e.effects.update(now);

    // apply inputs (senaste riktning per spelare)
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

    // simulera varje orm med smooth accumulator (ingen “teleport” på speed/slow)
    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;

      const mult = this.getSpeedMultiplier(entry); // SPEED/ SLOW
      const duration = this.baseMoveDuration / mult;

      entry.moveProgress += delta / duration;

      while (entry.moveProgress >= 1) {
        entry.moveProgress -= 1;

        // snapshot före step för interpolation
        entry.lastSegments = entry.snake.segments.map((s) => ({ ...s }));

        entry.snake.step();
        this.tickId += 1; // global counter, bara för debug/ordering

        this.resolveAfterStep(cid, entry, now);

        if (!entry.alive) break;
      }
    }

    // håll powerups på banan
    this.powerUps.ensureSpawn((x, y) => this.isCellBlockedHost(x, y));

    // render host smooth (per orm progress)
    const renderState = this.buildHostRenderState();
    this.renderer.render(renderState);

    // broadcast throttled (minskar nät-stutter)
    this.sendAccum += delta;
    if (this.sendAccum >= this.sendIntervalMs) {
      this.sendAccum = 0;
      this.onBroadcastState?.(this.buildSnapshotState());
    }

    const aliveCount = Array.from(this.snakes.values()).filter((e) => e.alive).length;
    if (aliveCount <= 1) this.endGameHost();
  }

  getSpeedMultiplier(entry) {
    let mult = 1;
    if (entry.effects.isActive(PowerUpType.SPEED)) mult *= EFFECT.SPEED_MULT;
    if (entry.effects.isActive(PowerUpType.SLOW)) mult *= EFFECT.SLOW_MULT;
    return Math.max(0.35, Math.min(3.0, mult));
  }

  resolveAfterStep(cid, entry, now) {
    const head = entry.snake.segments[0];

    // väggar: fortfarande dödligt
    if (head.x < 0 || head.x >= this.cols || head.y < 0 || head.y >= this.rows) {
      entry.alive = false;
      return;
    }

    const ghost = entry.effects.isActive(PowerUpType.GHOST);

    // ghost: IGNORERA ALLA SVANSKOLLISIONER (egen + andras)
    if (!ghost) {
      // self
      for (let i = 1; i < entry.snake.segments.length; i++) {
        const seg = entry.snake.segments[i];
        if (seg.x === head.x && seg.y === head.y) {
          entry.alive = false;
          return;
        }
      }

      // others
      for (const [oid, other] of this.snakes.entries()) {
        if (!other.alive) continue;
        if (oid === cid) continue;

        for (const seg of other.snake.segments) {
          if (seg.x === head.x && seg.y === head.y) {
            entry.alive = false;
            return;
          }
        }
      }
    }

    // powerup pickup
    const picked = this.powerUps.collectAt(head.x, head.y);
    if (picked) {
      // SPEED: bara mig
      if (picked.type === PowerUpType.SPEED) {
        entry.effects.activate(PowerUpType.SPEED, now, EFFECT.SPEED_MS);
      }

      // SLOW: alla ANDRA (inte mig)
      else if (picked.type === PowerUpType.SLOW) {
        for (const [oid, other] of this.snakes.entries()) {
          if (oid === cid) continue;
          if (!other.alive) continue;
          other.effects.activate(PowerUpType.SLOW, now, EFFECT.SLOW_MS);
        }
      }

      // GHOST: bara mig (men gäller mot allas svansar pga collision-check ovan)
      else if (picked.type === PowerUpType.GHOST) {
        entry.effects.activate(PowerUpType.GHOST, now, EFFECT.GHOST_MS);
      }

      // SHRINK: bara mig
      else if (picked.type === PowerUpType.SHRINK) {
        entry.snake.shrink(EFFECT.SHRINK_AMOUNT, EFFECT.MIN_SNAKE_LEN);
      }
    }

    // food
    const idx = this.foods.findIndex((f) => f.x === head.x && f.y === head.y);
    if (idx !== -1) {
      entry.snake.grow();
      entry.score += 10;
      this.foods.splice(idx, 1);
      this.spawnFoodHost();
    }
  }

  buildHostRenderState() {
    const snakes = [];

    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;

      const slot = this.players.get(cid)?.slot ?? 1;
      const c = colorsForSlot(slot);

      const cur = entry.snake.segments;
      const last = entry.lastSegments ?? cur;
      const p = Math.max(0, Math.min(1, entry.moveProgress));

      const segs = cur.map((seg, i) => {
        const prev = last[i];
        if (!prev) return { x: seg.x, y: seg.y };
        return {
          x: prev.x + (seg.x - prev.x) * p,
          y: prev.y + (seg.y - prev.y) * p,
        };
      });

      snakes.push({
        clientId: cid,
        segments: segs,
        mpColorBody: c.body,
        mpColorGlow: c.glow,
      });
    }

    return {
      snakes,
      foods: this.foods,
      powerUps: this.powerUps.powerUps,
      scores: this.buildScores(),
    };
  }

  buildSnapshotState() {
    // skickas till clients (grid coords, inget float)
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

    return {
      tickId: this.tickId,
      snakes,
      foods: this.foods,
      powerUps: this.powerUps.powerUps,
      scores: this.buildScores(),
    };
  }

  buildScores() {
    return Array.from(this.snakes.entries()).map(([cid, e]) => ({
      clientId: cid,
      name: this.players.get(cid)?.name ?? cid,
      score: e.score ?? 0,
      alive: !!e.alive,
      slot: this.players.get(cid)?.slot ?? 1,
    }));
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

  clientFrame() {
    const state = this.buildClientInterpolatedState();
    this.renderer.render(state);
  }

  buildClientInterpolatedState() {
    if (!this.currState) return { snakes: [], foods: [], powerUps: [], scores: [] };
    if (!this.prevState) return this.currState;

    const now = performance.now();
    // render lite “bakom” genom att använda avgInterval som tempo
    const alpha = Math.max(0, Math.min(1, (now - this.currRecvAt) / Math.max(16, this.avgInterval)));

    const prevSnakes = new Map((this.prevState.snakes ?? []).map((s) => [s.clientId, s]));
    const currSnakes = new Map((this.currState.snakes ?? []).map((s) => [s.clientId, s]));

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
      foods: this.currState.foods ?? [],
      powerUps: this.currState.powerUps ?? [],
      scores: this.currState.scores ?? [],
    };
  }
}

function colorsForSlot(slot) {
  // 1 = cyan (host/p1)
  if (slot === 2) return { body: "rgba(255, 220, 60, 0.95)", glow: "rgba(255, 220, 60, 0.85)" };
  if (slot === 3) return { body: "rgba(80, 255, 80, 0.95)", glow: "rgba(80, 255, 80, 0.85)" };
  if (slot === 4) return { body: "rgba(255, 90, 90, 0.95)", glow: "rgba(255, 90, 90, 0.85)" };
  return { body: "rgba(200, 255, 255, 0.95)", glow: "rgba(0, 255, 255, 0.85)" };
}
