// Game.js – singleplayer + powerups + specials (bonus/mirror) + hazards (holes)

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
  SPECIAL,
} from "./Config.js";
import { Renderer } from "./Renderer.js";
import { PowerUpManager, PowerUpType } from "./PowerUps.js";

export class Game {
  constructor(canvas, scoreElement) {
    this.canvas = canvas;
    this.scoreElement = scoreElement;

    this.cols = GRID_COLS;
    this.rows = GRID_ROWS;
    this.cellSize = CELL_SIZE;

    this.renderer = new Renderer(this.canvas, this.cols, this.rows, this.cellSize);

    this.snake = null;
    this.foods = [];
    this.score = 0;

    this.baseMoveDuration = 120;
    this.moveDuration = this.baseMoveDuration;
    this.isRunning = false;

    this.lastSegments = null;
    this.moveProgress = 0;
    this.lastTime = null;
    this.now = 0;

    this.foodSpawnToken = 0;
    this.powerSpawnToken = 0;

    this.onPlayerDeath = null;

    this.powerUps = new PowerUpManager({
      cols: this.cols,
      rows: this.rows,
      maxCount: POWERUP_COUNT,
      respawnMinMs: POWERUP_RESPAWN_MIN_MS,
      respawnMaxMs: POWERUP_RESPAWN_MAX_MS,
    });

    // === PATCH: multiplayer kan tillfälligt stänga av singleplayer-render ===
    this.renderEnabled = true;

    // === Singleplayer specials/hazards ===
    /** @type {{type:string,x:number,y:number,expiresAt:number}[]} */
    this.specials = []; // bonus + mirror on-board (expire if not taken)
    /** @type {{x:number,y:number,expiresAt:number}[]} */
    this.hazards = []; // holes

    this.mirroredUntil = 0;

    this.nextBonusAt = 0;
    this.nextMirrorAt = 0;
    this.nextHazardAt = 0;

    this.reset();
    this.startLoop();

    this.onFrame = [];
  }

  // === PATCH ===
  setRenderEnabled(enabled) {
    this.renderEnabled = !!enabled;
  }

  startGame() {
    // Om multiplayer har stängt av render: slå på igen när du startar singleplayer
    this.setRenderEnabled(true);

    this.reset();
    this.isRunning = true;
  }

  setOnPlayerDeath(callback) {
    this.onPlayerDeath = callback;
  }

  reset() {
    this.foodSpawnToken++;
    this.powerSpawnToken++;

    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ];
    const startDir = dirs[Math.floor(Math.random() * dirs.length)];

    const startX = Math.floor(this.cols / 2);
    const startY = Math.floor(this.rows / 2);

    this.snake = new Snake(startX, startY, {
      startDirection: startDir,
      colorHead: "#d783ff",
      colorHeadStroke: "#b300ff",
      colorBody: "#4dff4d",
      tailScale: 0.6,
    });

    this.score = 0;
    this.updateScore();

    this.foods = [];
    this.spawnInitialFood();

    this.powerUps.reset();
    this.powerUps.initSpawn((x, y) => this.isCellBlocked(x, y));

    this.lastSegments = this.snake.segments.map((seg) => ({ ...seg }));
    this.moveProgress = 0;

    this.moveDuration = this.baseMoveDuration;

    // Specials/hazards reset
    this.specials = [];
    this.hazards = [];
    this.mirroredUntil = 0;

    const now = performance.now();
    this.nextBonusAt = now + randRange(SPECIAL.BONUS_SPAWN_MIN_MS, SPECIAL.BONUS_SPAWN_MAX_MS);
    this.nextMirrorAt = now + randRange(SPECIAL.MIRROR_SPAWN_MIN_MS, SPECIAL.MIRROR_SPAWN_MAX_MS);
    this.nextHazardAt = now + randRange(SPECIAL.HAZARD_SPAWN_MIN_MS, SPECIAL.HAZARD_SPAWN_MAX_MS);
  }

  startLoop() {
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  }

  updateScore() {
    if (this.scoreElement) this.scoreElement.textContent = String(this.score);
  }

  spawnInitialFood() {
    for (let i = 0; i < FOOD_COUNT; i++) this.spawnFood();
  }

  spawnFood() {
    if (this.foods.length >= FOOD_COUNT) return;

    for (let safety = 0; safety < 1000; safety++) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * this.rows);

      const onSnake = this.snake.segments.some((seg) => seg.x === x && seg.y === y);
      const onFood = this.foods.some((f) => f.x === x && f.y === y);
      const onPower = this.powerUps.powerUps.some((p) => p.x === x && p.y === y);
      const onSpecial = this.specials.some((s) => s.x === x && s.y === y);
      const onHazard = this.hazards.some((h) => h.x === x && h.y === y);

      if (!onSnake && !onFood && !onPower && !onSpecial && !onHazard) {
        this.foods.push({ x, y });
        return;
      }
    }
  }

  scheduleFoodRespawn() {
    const tokenAtSchedule = this.foodSpawnToken;
    const delay = 500 + Math.random() * 2500;

    setTimeout(() => {
      if (tokenAtSchedule !== this.foodSpawnToken) return;
      if (this.foods.length >= FOOD_COUNT) return;
      this.spawnFood();
    }, delay);
  }

  schedulePowerRespawn() {
    const tokenAtSchedule = this.powerSpawnToken;
    const delay =
      POWERUP_RESPAWN_MIN_MS + Math.random() * (POWERUP_RESPAWN_MAX_MS - POWERUP_RESPAWN_MIN_MS);

    setTimeout(() => {
      if (tokenAtSchedule !== this.powerSpawnToken) return;
      this.powerUps.ensureSpawn((x, y) => this.isCellBlocked(x, y));
    }, delay);
  }

  isCellBlocked(x, y) {
    const onSnake = this.snake.segments.some((s) => s.x === x && s.y === y);
    const onFood = this.foods.some((f) => f.x === x && f.y === y);
    const onPower = this.powerUps.powerUps.some((p) => p.x === x && p.y === y);
    const onSpecial = this.specials.some((s) => s.x === x && s.y === y);
    const onHazard = this.hazards.some((h) => h.x === x && h.y === y);
    return onSnake || onFood || onPower || onSpecial || onHazard;
  }

  getSpeedMultiplier(now) {
    let mult = 1.0;
    if (this.powerUps.isActive(PowerUpType.SPEED)) mult *= EFFECT.SPEED_MULT;
    if (this.powerUps.isActive(PowerUpType.SLOW)) mult *= EFFECT.SLOW_MULT;
    return Math.max(0.35, Math.min(3.0, mult));
  }

  loop(timestamp) {
    if (this.lastTime == null) this.lastTime = timestamp;

    const delta = timestamp - this.lastTime;
    this.lastTime = timestamp;
    this.now = timestamp;

    // paus: rita bara om vi får
    if (!this.isRunning) {
      if (this.renderEnabled) this.render(this.moveProgress);
      requestAnimationFrame(this.loop.bind(this));
      return;
    }

    // Update effects
    this.powerUps.update(timestamp);

    // Update specials/hazards (expire + spawn timers)
    this._updateSpecialsAndHazards(timestamp);

    const mult = this.getSpeedMultiplier(timestamp);
    this.moveDuration = this.baseMoveDuration / mult;

    this.moveProgress += delta / this.moveDuration;

    while (this.moveProgress >= 1) {
      this.moveProgress -= 1;
      this.tick();
    }

    this.onFrame.forEach((cb) => cb(delta));

    if (this.renderEnabled) this.render(this.moveProgress);
    requestAnimationFrame(this.loop.bind(this));
  }

  _updateSpecialsAndHazards(now) {
    // Expire specials
    if (this.specials.length) {
      this.specials = this.specials.filter((s) => s.expiresAt > now);
    }
    // Expire hazards
    if (this.hazards.length) {
      this.hazards = this.hazards.filter((h) => h.expiresAt > now);
    }

    // Spawn BONUS (single instance at a time)
    if (!this.specials.some((s) => s.type === PowerUpType.BONUS) && now >= this.nextBonusAt) {
      this._spawnBonus(now);
      this.nextBonusAt = now + randRange(SPECIAL.BONUS_SPAWN_MIN_MS, SPECIAL.BONUS_SPAWN_MAX_MS);
    }

    // Spawn MIRROR (single instance at a time)
    if (!this.specials.some((s) => s.type === PowerUpType.MIRROR) && now >= this.nextMirrorAt) {
      this._spawnMirror(now);
      this.nextMirrorAt = now + randRange(SPECIAL.MIRROR_SPAWN_MIN_MS, SPECIAL.MIRROR_SPAWN_MAX_MS);
    }

    // Spawn hazards batch
    if (now >= this.nextHazardAt) {
      this._spawnHazards(now);
      this.nextHazardAt = now + randRange(SPECIAL.HAZARD_SPAWN_MIN_MS, SPECIAL.HAZARD_SPAWN_MAX_MS);
    }
  }

  _spawnBonus(now) {
    const pos = this._findRandomFreeCell();
    if (!pos) return;
    this.specials.push({
      type: PowerUpType.BONUS,
      x: pos.x,
      y: pos.y,
      expiresAt: now + SPECIAL.BONUS_LIFETIME_MS,
    });
  }

  _spawnMirror(now) {
    // Prefer: 3 rutor framför ormen
    const head = this.snake.segments[0];
    const dir = this.snake.direction ?? { x: 1, y: 0 };

    const target = {
      x: head.x + dir.x * 3,
      y: head.y + dir.y * 3,
    };

    const pos =
      this._findNearTargetFreeCell(target.x, target.y, 3) ?? this._findRandomFreeCell();

    if (!pos) return;

    this.specials.push({
      type: PowerUpType.MIRROR,
      x: pos.x,
      y: pos.y,
      expiresAt: now + SPECIAL.MIRROR_LIFETIME_MS,
    });
  }

  _spawnHazards(now) {
    const count = randInt(SPECIAL.HAZARD_COUNT_MIN, SPECIAL.HAZARD_COUNT_MAX);
    for (let i = 0; i < count; i++) {
      const pos = this._findRandomFreeCell();
      if (!pos) break;

      this.hazards.push({
        x: pos.x,
        y: pos.y,
        expiresAt: now + SPECIAL.HAZARD_LIFETIME_MS,
      });
    }
  }

  _findRandomFreeCell() {
    for (let tries = 0; tries < 800; tries++) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * this.rows);
      if (!this.isCellBlocked(x, y)) return { x, y };
    }
    return null;
  }

  _findNearTargetFreeCell(tx, ty, radius) {
    // Clamp target first
    tx = Math.max(0, Math.min(this.cols - 1, tx));
    ty = Math.max(0, Math.min(this.rows - 1, ty));

    if (!this.isCellBlocked(tx, ty)) return { x: tx, y: ty };

    // Spiral-ish ring search
    for (let r = 1; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) continue;
          if (!this.isCellBlocked(x, y)) return { x, y };
        }
      }
    }
    return null;
  }

  tick() {
    this.lastSegments = this.snake.segments.map((seg) => ({ ...seg }));

    this.snake.step();
    const head = this.snake.segments[0];

    // Wall
    if (head.x < 0 || head.x >= this.cols || head.y < 0 || head.y >= this.rows) {
      this.handleDeath();
      return;
    }

    // Hazards/holes
    if (this.hazards.some((h) => h.x === head.x && h.y === head.y)) {
      this.handleDeath();
      return;
    }

    // Self collision (unless ghost)
    const isGhost = this.powerUps.isActive(PowerUpType.GHOST);
    if (!isGhost) {
      for (let i = 1; i < this.snake.segments.length; i++) {
        const seg = this.snake.segments[i];
        if (seg.x === head.x && seg.y === head.y) {
          this.handleDeath();
          return;
        }
      }
    }

    // Specials pickup (bonus/mirror)
    const sidx = this.specials.findIndex((s) => s.x === head.x && s.y === head.y);
    if (sidx !== -1) {
      const picked = this.specials.splice(sidx, 1)[0];

      if (picked.type === PowerUpType.BONUS) {
		window.__trakeSfx?.play("yum");
		window.__trakeSfx?.play("plus100");
        this.score += SPECIAL.BONUS_SCORE;
        this.updateScore();
      } else if (picked.type === PowerUpType.MIRROR) {
		window.__trakeSfx?.play("yum");
		window.__trakeSfx?.play("mirrored");
        this.mirroredUntil = Math.max(this.mirroredUntil, this.now + SPECIAL.MIRROR_EFFECT_MS);
      }
    }

    // Regular powerups pickup
    const picked = this.powerUps.collectAt(head.x, head.y);
    if (picked) {
      switch (picked.type) {
        case PowerUpType.SPEED:
          this.powerUps.activate(PowerUpType.SPEED, this.now, EFFECT.SPEED_MS);
		  window.__trakeSfx?.play("zoom");
		  window.__trakeSfx?.play("speed");
          break;
        case PowerUpType.SLOW:
          this.powerUps.activate(PowerUpType.SLOW, this.now, EFFECT.SLOW_MS);
		  window.__trakeSfx?.play("yum");
          break;
        case PowerUpType.GHOST:
          this.powerUps.activate(PowerUpType.GHOST, this.now, EFFECT.GHOST_MS);
		  window.__trakeSfx?.play("yum");
		  window.__trakeSfx?.play("ghosting");
          break;
        case PowerUpType.SHRINK:
          this.snake.shrink(EFFECT.SHRINK_AMOUNT, EFFECT.MIN_SNAKE_LEN);
		  window.__trakeSfx?.play("yum");
          break;
      }
      this.schedulePowerRespawn();
    }

    // Food
    const eatenIndex = this.foods.findIndex((f) => f.x === head.x && f.y === head.y);
    if (eatenIndex !== -1) {
      this.snake.grow();
      this.score += 10;
	  window.__trakeSfx?.play("yum");
      this.updateScore();

      this.foods.splice(eatenIndex, 1);
      this.scheduleFoodRespawn();
    }
  }

  handleDeath() {
    this.isRunning = false;
	window.__trakeSfx?.play("crash");
    if (this.onPlayerDeath) this.onPlayerDeath({ score: this.score });
  }

  render(progress = 1) {
    const segmentsToDraw = this.snake.segments.map((seg, index) => {
      if (!this.lastSegments || !this.lastSegments[index]) return { x: seg.x, y: seg.y };
      const prev = this.lastSegments[index];
      return {
        x: prev.x + (seg.x - prev.x) * progress,
        y: prev.y + (seg.y - prev.y) * progress,
      };
    });

    const state = {
      foods: this.foods,
      powerUps: this.powerUps.powerUps,
      activeEffects: this.powerUps.activeEffects,

      specials: this.specials,
      hazards: this.hazards,

      snakes: [
        {
          segments: segmentsToDraw,
          colorHead: this.snake.colorHead,
          colorHeadStroke: this.snake.colorHeadStroke,
          colorBody: this.snake.colorBody,
          tailScale: this.snake.tailScale,
        },
      ],
    };

    this.renderer.render(state);
  }

  // Arrow keys + WASD, med mirror-stöd (singleplayer)
  handleKeyDown(key) {
    const mirrored = this.now < this.mirroredUntil;
    const dir = keyToDir(key, mirrored);
    if (!dir) return;
    this.snake.setDirection(dir.x, dir.y);
  }
}

function keyToDir(key, mirrored) {
  // Normal mapping
  let dir = null;
  switch (key) {
    case "ArrowUp":
    case "w":
    case "W":
      dir = { x: 0, y: -1 };
      break;

    case "ArrowDown":
    case "s":
    case "S":
      dir = { x: 0, y: 1 };
      break;

    case "ArrowLeft":
    case "a":
    case "A":
      dir = { x: -1, y: 0 };
      break;

    case "ArrowRight":
    case "d":
    case "D":
      dir = { x: 1, y: 0 };
      break;

    default:
      return null;
  }

  if (!mirrored) return dir;
  return { x: -dir.x, y: -dir.y };
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, maxInclusive) {
  const span = maxInclusive - min + 1;
  return min + Math.floor(Math.random() * span);
}
