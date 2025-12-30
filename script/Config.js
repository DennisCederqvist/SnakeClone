// Config.js – gemensam konfiguration för spelet

export const GRID_COLS = 40;
export const GRID_ROWS = 30;
export const CELL_SIZE = 30;

export const FOOD_COUNT = 10;

// Powerups (hur många som får finnas samtidigt)
export const POWERUP_COUNT = 3;
export const POWERUP_RESPAWN_MIN_MS = 500;
export const POWERUP_RESPAWN_MAX_MS = 3000;

// Effekter
export const EFFECT = {
  SPEED_MULT: 1.5,
  SPEED_MS: 3000,

  // Singleplayer: SLOW påverkar dig, i multiplayer ska den påverka alla utom den som plockar upp den.
  SLOW_MULT: 0,
  SLOW_MS: 3500,

  // Ghost: ignorerar self-collision (väggen är fortfarande dödlig)
  GHOST_MS: 2500,

  // Shrink: hur många segment som försvinner direkt
  SHRINK_AMOUNT: 4,
  MIN_SNAKE_LEN: 2,
};

// === Singleplayer specials ===
export const SPECIAL = {
  // BONUS: dyker upp ibland, finns 5s, ger +100 poäng om du tar den.
  BONUS_SCORE: 100,
  BONUS_LIFETIME_MS: 3000,
  BONUS_SPAWN_MIN_MS: 6000,
  BONUS_SPAWN_MAX_MS: 14000,

  // MIRROR: spawnar 3 rutor framför ormen, finns 3s, om du tar den -> invert 3s
  MIRROR_LIFETIME_MS: 3000,
  MIRROR_EFFECT_MS: 3000,
  MIRROR_SPAWN_MIN_MS: 9000,
  MIRROR_SPAWN_MAX_MS: 18000,

  // HAZARDS/holes: dyker upp ibland, finns 5s, dödar vid kollision.
  HAZARD_LIFETIME_MS: 10000,
  HAZARD_SPAWN_MIN_MS: 7000,
  HAZARD_SPAWN_MAX_MS: 16000,
  HAZARD_COUNT_MIN: 2,
  HAZARD_COUNT_MAX: 5,
};

export const COLORS = {
  background: "#111",
  borderStroke: "#444",

  gridLine: "rgba(255, 255, 255, 0.06)",
  gridGlow: "rgba(0, 255, 255, 0.10)",
};
