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

  // Singleplayer: SLOW påverkar dig (tills multiplayer finns)
  SLOW_MULT: 0.7,
  SLOW_MS: 3500,

  // Ghost: ignorerar self-collision (väggen är fortfarande dödlig)
  GHOST_MS: 2500,

  // Shrink: hur många segment som försvinner direkt
  SHRINK_AMOUNT: 4,
  MIN_SNAKE_LEN: 2,
};

export const COLORS = {
  background: "#111",
  borderStroke: "#444",

  gridLine: "rgba(255, 255, 255, 0.06)",
  gridGlow: "rgba(0, 255, 255, 0.10)",
};
