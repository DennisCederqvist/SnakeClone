// PowerUps.js – spawn + pickup + timed effects (singleplayer nu, multiplayer sen)

export const PowerUpType = {
  SPEED: "speed",
  SLOW: "slow",
  GHOST: "ghost",
  SHRINK: "shrink",

  // OBS: används inte i random-spawn (singleplayer specials hanteras i Game),
  // men finns här så Renderer kan färga dem om du senare vill flytta in dem i powerup-systemet.
  BONUS: "bonus",
  MIRROR: "mirror",
};

export class PowerUpManager {
  constructor({
    cols,
    rows,
    maxCount = 3,
    respawnMinMs = 500,
    respawnMaxMs = 3000,
  }) {
    this.cols = cols;
    this.rows = rows;

    this.maxCount = maxCount;
    this.respawnMinMs = respawnMinMs;
    this.respawnMaxMs = respawnMaxMs;

    /** @type {{type:string,x:number,y:number}[]} */
    this.powerUps = [];

    /** @type {{type:string, endsAt:number}[]} */
    this.activeEffects = [];

    this._spawnToken = 0;
  }

  reset() {
    this._spawnToken++;
    this.powerUps = [];
    this.activeEffects = [];
  }

  update(now) {
    // rensa utgångna effekter
    this.activeEffects = this.activeEffects.filter((e) => e.endsAt > now);
  }

  isActive(type) {
    return this.activeEffects.some((e) => e.type === type);
  }

  activate(type, now, durationMs) {
    // en effekt per typ
    this.activeEffects = this.activeEffects.filter((e) => e.type !== type);
    this.activeEffects.push({ type, endsAt: now + durationMs });
  }

  initSpawn(isBlockedCell) {
    // fyll upp till maxCount direkt vid game start
    while (this.powerUps.length < this.maxCount) {
      this._spawnOne(isBlockedCell);
    }
  }

  scheduleRespawn() {
    const tokenAtSchedule = this._spawnToken;
    const delay =
      this.respawnMinMs +
      Math.random() * (this.respawnMaxMs - this.respawnMinMs);

    setTimeout(() => {
      if (tokenAtSchedule !== this._spawnToken) return;
      // själva spawnen görs av Game när den kallar initSpawn() igen
    }, delay);

    return { tokenAtSchedule, delay };
  }

  ensureSpawn(isBlockedCell) {
    // håll alltid maxCount på banan
    while (this.powerUps.length < this.maxCount) {
      this._spawnOne(isBlockedCell);
    }
  }

  collectAt(x, y) {
    const idx = this.powerUps.findIndex((p) => p.x === x && p.y === y);
    if (idx === -1) return null;
    return this.powerUps.splice(idx, 1)[0];
  }

  _randomType() {
    const types = [
      PowerUpType.SPEED,
      PowerUpType.SLOW,
      PowerUpType.GHOST,
      PowerUpType.SHRINK,
    ];
    return types[Math.floor(Math.random() * types.length)];
  }

  _spawnOne(isBlockedCell) {
    for (let tries = 0; tries < 500; tries++) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * this.rows);

      if (isBlockedCell?.(x, y)) continue;
      if (this.powerUps.some((p) => p.x === x && p.y === y)) continue;

      this.powerUps.push({
        type: this._randomType(),
        x,
        y,
      });
      return true;
    }
    return false;
  }
}
