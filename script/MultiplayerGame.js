// MultiplayerGame.js – host-auktoritativ multiplayer-simulering + client rendering
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

    this.players = players; // Map clientId -> {name, slot}
    this.hostClientId = hostClientId;

    this.onBroadcastState = onBroadcastState;
    this.onEnd = onEnd;

    this.foods = [];
    this.powerUps = new PowerUpManager({
      cols: this.cols,
      rows: this.rows,
      maxCount: POWERUP_COUNT,
      respawnMinMs: POWERUP_RESPAWN_MIN_MS,
      respawnMaxMs: POWERUP_RESPAWN_MAX_MS,
    });

    this.baseMoveDuration = 120;
    this.moveDuration = this.baseMoveDuration;
    this.isRunning = false;

    this.lastTime = null;
    this.moveProgress = 0;
    this.lastSegmentsByClient = new Map();

    this.snakes = new Map(); // clientId -> { snake, score, alive, effects }
    this.remoteState = null;

    this.pendingKeys = new Map();
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

  applyRemoteInput(clientId, key) {
    if (this.mode !== "host") return;
    this.pendingKeys.set(clientId, key);
  }

  applyRemoteState(state) {
    if (this.mode !== "client") return;
    this.remoteState = state;
  }

  resetHostWorld() {
    this.foods = [];
    this.snakes.clear();
    this.lastSegmentsByClient.clear();

    const clientIds = Array.from(this.players.keys()).sort();
    const spawns = this.makeSpawnPoints(clientIds.length);

    for (let i = 0; i < clientIds.length; i++) {
      const cid = clientIds[i];
      const spawn = spawns[i] ?? { x: Math.floor(this.cols / 2), y: Math.floor(this.rows / 2) };

      const dirOptions = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ];
      const startDir = dirOptions[i % dirOptions.length];

      // Snake-objektets interna färger spelar ingen roll för rendering längre.
      const snake = new Snake(spawn.x, spawn.y, {
        startDirection: startDir,
      });

      this.snakes.set(cid, {
        snake,
        score: 0,
        alive: true,
        effects: new PowerUpManager({
          cols: this.cols,
          rows: this.rows,
          maxCount: 0,
          respawnMinMs: 0,
          respawnMaxMs: 0,
        }),
      });

      this.lastSegmentsByClient.set(cid, snake.segments.map((s) => ({ ...s })));
    }

    for (let i = 0; i < FOOD_COUNT; i++) this.spawnFoodHost();

    this.powerUps.reset();
    this.powerUps.initSpawn((x, y) => this.isCellBlockedHost(x, y));
  }

  makeSpawnPoints(n) {
    const pts = [];
    const margin = 4;

    const candidates = [
      { x: margin, y: margin },
      { x: this.cols - 1 - margin, y: margin },
      { x: margin, y: this.rows - 1 - margin },
      { x: this.cols - 1 - margin, y: this.rows - 1 - margin },
    ];

    for (let i = 0; i < n; i++) pts.push(candidates[i] ?? candidates[0]);
    return pts;
  }

  loop(timestamp) {
    if (!this.isRunning) return;

    const delta = timestamp - (this.lastTime ?? timestamp);
    this.lastTime = timestamp;

    if (this.mode === "host") {
      this.moveProgress += delta / this.moveDuration;

      while (this.moveProgress >= 1) {
        this.moveProgress -= 1;
        this.tickHost(timestamp);
      }

      this.renderHost(this.moveProgress);

      if (this.onBroadcastState) {
        this.onBroadcastState(this.buildStateSnapshot(this.moveProgress));
      }
    } else {
      this.renderClient();
    }

    requestAnimationFrame(this.loop.bind(this));
  }

  tickHost(now) {
    this.powerUps.update(now);

    for (const [cid, key] of this.pendingKeys.entries()) {
      const entry = this.snakes.get(cid);
      if (!entry?.alive) continue;

      const snake = entry.snake;
      switch (key) {
        case "ArrowUp":
          snake.setDirection(0, -1);
          break;
        case "ArrowDown":
          snake.setDirection(0, 1);
          break;
        case "ArrowLeft":
          snake.setDirection(-1, 0);
          break;
        case "ArrowRight":
          snake.setDirection(1, 0);
          break;
      }
    }
    this.pendingKeys.clear();

    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;
      this.lastSegmentsByClient.set(cid, entry.snake.segments.map((s) => ({ ...s })));
    }

    for (const entry of this.snakes.values()) {
      if (!entry.alive) continue;
      entry.snake.step();
    }

    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;

      const head = entry.snake.segments[0];

      // vägg
      if (head.x < 0 || head.x >= this.cols || head.y < 0 || head.y >= this.rows) {
        entry.alive = false;
        continue;
      }

      // self collision (ghost ignorerar self)
      const isGhost = entry.effects.isActive(PowerUpType.GHOST);
      if (!isGhost) {
        for (let i = 1; i < entry.snake.segments.length; i++) {
          const seg = entry.snake.segments[i];
          if (seg.x === head.x && seg.y === head.y) {
            entry.alive = false;
            break;
          }
        }
        if (!entry.alive) continue;
      }

      // collision mot andra (alltid dödligt)
      for (const [otherId, otherEntry] of this.snakes.entries()) {
        if (!otherEntry.alive) continue;

        const segs = otherEntry.snake.segments;
        const startIndex = otherId === cid ? 1 : 0;
        for (let i = startIndex; i < segs.length; i++) {
          const seg = segs[i];
          if (seg.x === head.x && seg.y === head.y) {
            entry.alive = false;
            break;
          }
        }
        if (!entry.alive) break;
      }
      if (!entry.alive) continue;

      // powerup pickup
      const picked = this.powerUps.collectAt(head.x, head.y);
      if (picked) {
        switch (picked.type) {
          case PowerUpType.SPEED:
            entry.effects.activate(PowerUpType.SPEED, now, EFFECT.SPEED_MS);
            break;

          case PowerUpType.SLOW:
            for (const [oid, oe] of this.snakes.entries()) {
              if (oid === cid) continue;
              oe.effects.activate(PowerUpType.SLOW, now, EFFECT.SLOW_MS);
            }
            break;

          case PowerUpType.GHOST:
            entry.effects.activate(PowerUpType.GHOST, now, EFFECT.GHOST_MS);
            break;

          case PowerUpType.SHRINK:
            entry.snake.shrink(EFFECT.SHRINK_AMOUNT, EFFECT.MIN_SNAKE_LEN);
            break;
        }

        this.powerUps.ensureSpawn((x, y) => this.isCellBlockedHost(x, y));
      }

      // mat
      const eatenIndex = this.foods.findIndex((f) => f.x === head.x && f.y === head.y);
      if (eatenIndex !== -1) {
        entry.snake.grow();
        entry.score += 10;
        this.foods.splice(eatenIndex, 1);
        this.spawnFoodHost();
      }

      entry.effects.update(now);
    }

    this.moveDuration = this.baseMoveDuration;

    const alive = Array.from(this.snakes.values()).filter((e) => e.alive).length;
    if (alive <= 1) {
      this.endGameHost();
    }
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

    this.onEnd?.({
      winnerName: winner?.name ?? "Winner",
      scores,
    });
  }

  spawnFoodHost() {
    if (this.foods.length >= FOOD_COUNT) return;

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
    for (const entry of this.snakes.values()) {
      if (!entry.alive) continue;
      if (entry.snake.segments.some((s) => s.x === x && s.y === y)) return true;
    }
    if (this.foods.some((f) => f.x === x && f.y === y)) return true;
    if (this.powerUps.powerUps.some((p) => p.x === x && p.y === y)) return true;
    return false;
  }

  buildStateSnapshot(progress) {
    const snakes = [];

    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;

      const last = this.lastSegmentsByClient.get(cid);
      const cur = entry.snake.segments;

      const segs = cur.map((seg, idx) => {
        const prev = last?.[idx];
        if (!prev) return { x: seg.x, y: seg.y };
        return {
          x: prev.x + (seg.x - prev.x) * progress,
          y: prev.y + (seg.y - prev.y) * progress,
        };
      });

      const slot = this.players.get(cid)?.slot ?? 1;
      const colors = colorsForSlot(slot);

      snakes.push({
        clientId: cid,
        segments: segs,
        mpColorBody: colors.body,
        mpColorGlow: colors.glow,
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
      snakes,
      foods: this.foods,
      powerUps: this.powerUps.powerUps,
      scores,
    };
  }

  renderHost(progress) {
    const state = this.buildStateSnapshot(progress);
    this.renderer.render(state);
  }

  renderClient() {
    this.renderer.render(this.remoteState ?? { snakes: [], foods: [], powerUps: [], scores: [] });
  }
}

function colorsForSlot(slot) {
  // Slot 1 = cyan (alltid)
  if (slot === 2) {
    return { body: "rgba(255, 220, 60, 0.95)", glow: "rgba(255, 220, 60, 0.85)" };
  }
  if (slot === 3) {
    return { body: "rgba(80, 255, 80, 0.95)", glow: "rgba(80, 255, 80, 0.85)" };
  }
  if (slot === 4) {
    return { body: "rgba(255, 90, 90, 0.95)", glow: "rgba(255, 90, 90, 0.85)" };
  }
  return { body: "rgba(200, 255, 255, 0.95)", glow: "rgba(0, 255, 255, 0.85)" };
}
