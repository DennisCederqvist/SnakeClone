// Game.js – håller all logik för spelet (singleplayer än så länge)

import { Snake } from "./Snake.js";
import { GRID_COLS, GRID_ROWS, CELL_SIZE, FOOD_COUNT } from "./Config.js";
import { Renderer } from "./Renderer.js";

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

		// Hastighet + paus
		this.baseMoveDuration = 120;
		this.moveDuration = this.baseMoveDuration;
		this.isBoosting = false;
		this.isRunning = false;   // ⬅ nytt: spelet startar pausat

		this.lastSegments = null;
		this.moveProgress = 0;
		this.lastTime = null;

		this.foodSpawnToken = 0;

		this.reset();      // ⬅ förbereder state
		this.startLoop();  // ⬅ startar bara render-loop, inte spelet
	}

	// Kör igång själva spelet (efter startskärm)
	startGame() {
		this.reset();
		this.isRunning = true;
	}

	reset() {
		// Ogiltigförklara gamla food-timers
		this.foodSpawnToken++;

		const dirs = [
			{ x: 1, y: 0 },   // höger
			{ x: -1, y: 0 },  // vänster
			{ x: 0, y: -1 },  // upp
			{ x: 0, y: 1 }    // ner
		];

		const startDir = dirs[Math.floor(Math.random() * dirs.length)];

		const startX = Math.floor(this.cols / 2);
		const startY = Math.floor(this.rows / 2);

		this.snake = new Snake(startX, startY, {
			startDirection: startDir,
			colorHead: "#d783ff",
			colorHeadStroke: "#b300ff",
			colorBody: "#4dff4d",
			tailScale: 0.6
		});

		this.score = 0;
		this.updateScore();

		this.foods = [];
		this.spawnInitialFood();

		this.lastSegments = this.snake.segments.map(seg => ({ ...seg }));
		this.moveProgress = 0;

		// Vi rör inte isRunning här
		this.isBoosting = false;
		this.moveDuration = this.baseMoveDuration;
	}

	startLoop() {
		this.lastTime = performance.now();
		requestAnimationFrame(this.loop.bind(this));
	}

	updateScore() {
		if (this.scoreElement) {
			this.scoreElement.textContent = String(this.score);
		}
	}

	spawnInitialFood() {
		for (let i = 0; i < FOOD_COUNT; i++) {
			this.spawnFood();
		}
	}

	spawnFood() {
		if (this.foods.length >= FOOD_COUNT) return;

		let safety = 0;

		while (safety < 1000) {
			safety++;
			const x = Math.floor(Math.random() * this.cols);
			const y = Math.floor(Math.random() * this.rows);

			const onSnake = this.snake.segments.some(seg => seg.x === x && seg.y === y);
			const onFood = this.foods.some(food => food.x === x && food.y === y);

			if (!onSnake && !onFood) {
				this.foods.push({ x, y });
				return;
			}
		}
	}

	scheduleFoodRespawn() {
		const tokenAtSchedule = this.foodSpawnToken;
		const delay = 500 + Math.random() * 2500; // 0.5s – 3s

		setTimeout(() => {
			if (tokenAtSchedule !== this.foodSpawnToken) return;
			if (this.foods.length >= FOOD_COUNT) return;

			this.spawnFood();
		}, delay);
	}

	loop(timestamp) {
		if (this.lastTime == null) {
			this.lastTime = timestamp;
		}

		const delta = timestamp - this.lastTime;
		this.lastTime = timestamp;

		// Om spelet inte körs → bara rendera nu-läget och fortsätt loopa
		if (!this.isRunning) {
			this.render(this.moveProgress);
			requestAnimationFrame(this.loop.bind(this));
			return;
		}

		this.moveProgress += delta / this.moveDuration;

		while (this.moveProgress >= 1) {
			this.moveProgress -= 1;
			this.tick();
		}

		this.render(this.moveProgress);

		requestAnimationFrame(this.loop.bind(this));
	}

	tick() {
		this.lastSegments = this.snake.segments.map(seg => ({ ...seg }));

		this.snake.step();
		const head = this.snake.segments[0];

		if (
			head.x < 0 ||
			head.x >= this.cols ||
			head.y < 0 ||
			head.y >= this.rows
		) {
			this.handleDeath();
			return;
		}

		for (let i = 1; i < this.snake.segments.length; i++) {
			const seg = this.snake.segments[i];
			if (seg.x === head.x && seg.y === head.y) {
				this.handleDeath();
				return;
			}
		}

		const eatenIndex = this.foods.findIndex(
			(food) => food.x === head.x && food.y === head.y
		);

		if (eatenIndex !== -1) {
			this.snake.grow();
			this.score += 10;
			this.updateScore();

			this.foods.splice(eatenIndex, 1);
			this.scheduleFoodRespawn();
		}
	}

	handleDeath() {
		// Just nu: direkt respawn, fortfarande running
		this.reset();
	}

	render(progress = 1) {
		const segmentsToDraw = this.snake.segments.map((seg, index) => {
			if (!this.lastSegments || !this.lastSegments[index]) {
				return { x: seg.x, y: seg.y };
			}

			const prev = this.lastSegments[index];

			return {
				x: prev.x + (seg.x - prev.x) * progress,
				y: prev.y + (seg.y - prev.y) * progress
			};
		});

		const state = {
			foods: this.foods,
			snakes: [
				{
					segments: segmentsToDraw,
					colorHead: this.snake.colorHead,
					colorHeadStroke: this.snake.colorHeadStroke,
					colorBody: this.snake.colorBody,
					tailScale: this.snake.tailScale
				}
			]
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
		this.moveDuration = this.baseMoveDuration / 2;
	}

	disableBoost() {
		if (!this.isBoosting) return;
		this.isBoosting = false;
		this.moveDuration = this.baseMoveDuration;
	}
}
