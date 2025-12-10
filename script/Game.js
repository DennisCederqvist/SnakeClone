// Game.js – håller all logik för spelet (singleplayer än så länge)

import { Snake } from "./Snake.js";
import { GRID_COLS, GRID_ROWS, CELL_SIZE } from "./Config.js";
import { Renderer } from "./Renderer.js";

export class Game {
  constructor(canvas, scoreElement) {
    this.canvas = canvas;
    this.scoreElement = scoreElement;

    this.cols = GRID_COLS;
    this.rows = GRID_ROWS;
    this.cellSize = CELL_SIZE;

    this.renderer = new Renderer(
      this.canvas,
      this.cols,
      this.rows,
      this.cellSize
    );

    this.snake = null;
    this.food = null;
    this.score = 0;

    // Smooth-movement + hastighet
    this.baseMoveDuration = 100; // ms per grid-steg (normalhastighet)
    this.moveDuration = this.baseMoveDuration; // aktuell hastighet
    this.isBoosting = false;

    this.lastSegments = null;
    this.moveProgress = 0;
    this.lastTime = null;

    this.reset();
    this.start();
  }

  reset() {
    const dirs = [
      { x: 1, y: 0 }, // höger
      { x: -1, y: 0 }, // vänster
      { x: 0, y: -1 }, // upp
      { x: 0, y: 1 }, // ner
    ];

    const startDir = dirs[Math.floor(Math.random() * dirs.length)];
    // Starta ormen i mitten
    const startX = Math.floor(this.cols / 2);
    const startY = Math.floor(this.rows / 2);

    // Här skapar vi en (än så länge enda) orm
    this.snake = new Snake(startX, startY, {
      startDirection: startDir,
      colorHead: "#d783ff",
      colorHeadStroke: "#b300ff",
      colorBody: "#4dff4d",
      tailScale: 0.6,
    });

    this.score = 0;
    this.updateScore();

    this.spawnFood();

    // Vid reset: ingen interpolation, ormen står still
    this.lastSegments = this.snake.segments.map((seg) => ({ ...seg }));
    this.moveProgress = 0;

    // Återställ speedboost vid reset
    this.isBoosting = false;
    this.moveDuration = this.baseMoveDuration;
  }

  start() {
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  }

  updateScore() {
    if (this.scoreElement) {
      this.scoreElement.textContent = String(this.score);
    }
  }

  spawnFood() {
    // Slumpa position som inte ligger på ormen
    while (true) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * this.rows);

      const onSnake = this.snake.segments.some(
        (seg) => seg.x === x && seg.y === y
      );
      if (!onSnake) {
        this.food = { x, y };
        return;
      }
    }
  }

  loop(timestamp) {
    if (this.lastTime == null) {
      this.lastTime = timestamp;
    }

    const delta = timestamp - this.lastTime; // ms sedan förra frame
    this.lastTime = timestamp;

    // Hur långt in i ett steg (0–1)
    this.moveProgress += delta / this.moveDuration;

    // När vi passerar 1.0 gör vi ett nytt steg (tick)
    while (this.moveProgress >= 1) {
      this.moveProgress -= 1;
      this.tick();
    }

    // Rita, med interpolation
    this.render(this.moveProgress);

    requestAnimationFrame(this.loop.bind(this));
  }

  tick() {
    // Spara föregående segment-positioner för interpolation
    this.lastSegments = this.snake.segments.map((seg) => ({ ...seg }));

    this.snake.step();
    const head = this.snake.segments[0];

    // Kollision med vägg
    if (
      head.x < 0 ||
      head.x >= this.cols ||
      head.y < 0 ||
      head.y >= this.rows
    ) {
      this.handleDeath();
      return;
    }

    // Kollision med egen kropp
    for (let i = 1; i < this.snake.segments.length; i++) {
      const seg = this.snake.segments[i];
      if (seg.x === head.x && seg.y === head.y) {
        this.handleDeath();
        return;
      }
    }

    // Kollision med mat
    if (this.food && head.x === this.food.x && head.y === this.food.y) {
      this.snake.grow();
      this.score += 10;
      this.updateScore();
      this.spawnFood();
      // ingen ändring av this.lastSegments här → ingen “paus” i rörelsen
    }
  }

  handleDeath() {
    // Reset vid död
    this.reset();
  }

  // Bygger upp "render state" och skickar till Renderer
  render(progress = 1) {
    // Interpolera ormens segmentpositioner mellan lastSegments och nuvarande
    const segmentsToDraw = this.snake.segments.map((seg, index) => {
      if (!this.lastSegments || !this.lastSegments[index]) {
        return { x: seg.x, y: seg.y };
      }

      const prev = this.lastSegments[index];

      return {
        x: prev.x + (seg.x - prev.x) * progress,
        y: prev.y + (seg.y - prev.y) * progress,
      };
    });

    const state = {
      food: this.food,
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

  // ==== INPUT-HANTERING ====

  handleKeyDown(key) {
    switch (key) {
      case "ArrowUp":
        this.snake.setDirection(0, -1);
        break;
      case "ArrowDown":
        this.snake.setDirection(0, 1);
        break;
      case "ArrowLeft":
        this.snake.setDirection(-1, 0);
        break;
      case "ArrowRight":
        this.snake.setDirection(1, 0);
        break;
      case "Space":
        this.enableBoost();
        break;
    }
  }

  handleKeyUp(key) {
    switch (key) {
      case "Space":
        this.disableBoost();
        break;
    }
  }

  enableBoost() {
    if (this.isBoosting) return;
    this.isBoosting = true;

    // 50% snabbare ≈ 1.5x speed → duration / 1.5
    this.moveDuration = this.baseMoveDuration / 2;
  }

  disableBoost() {
    if (!this.isBoosting) return;
    this.isBoosting = false;
    this.moveDuration = this.baseMoveDuration;
  }
}
