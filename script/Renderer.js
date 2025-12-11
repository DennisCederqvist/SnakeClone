// Renderer.js – ansvarar för att rita spelplan, mat och alla ormar

import { COLORS } from "./Config.js";

export class Renderer {
	constructor(canvas, cols, rows, cellSize) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d");

		this.cols = cols;
		this.rows = rows;
		this.cellSize = cellSize;

		// Sätt canvas storlek efter grid
		this.canvas.width = this.cols * this.cellSize;
		this.canvas.height = this.rows * this.cellSize;
	}

	render(state) {
		const ctx = this.ctx;

		// Bakgrund
		ctx.fillStyle = COLORS.background;
		ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

		// Rita spelplanens ram
		ctx.strokeStyle = COLORS.borderStroke;
		ctx.lineWidth = 2;
		ctx.strokeRect(0, 0, this.cols * this.cellSize, this.rows * this.cellSize);

		// Mat – nu flera
		if (state.foods && state.foods.length > 0) {
			for (const food of state.foods) {
				const fx = (food.x + 0.5) * this.cellSize;
				const fy = (food.y + 0.5) * this.cellSize;
				const fr = this.cellSize / 2 - 2;

				ctx.beginPath();
				ctx.arc(fx, fy, fr, 0, Math.PI * 2);
				ctx.fillStyle = COLORS.foodFill;
				ctx.fill();
			}
		}

		// Ormar
		for (const snake of state.snakes) {
			const segments = snake.segments;

			segments.forEach((seg, index) => {
				const cx = (seg.x + 0.5) * this.cellSize;
				const cy = (seg.y + 0.5) * this.cellSize;

				let r = this.cellSize / 2 - 2;

				// svanstipp mindre – styrs av snake.tailScale
				if (index === segments.length - 1) {
					r *= snake.tailScale ?? 0.6;
				}

				ctx.beginPath();
				ctx.arc(cx, cy, r, 0, Math.PI * 2);

				if (index === 0) {
					// huvud
					ctx.fillStyle = snake.colorHead;
					ctx.strokeStyle = snake.colorHeadStroke;
					ctx.lineWidth = 3;
					ctx.fill();
					ctx.stroke();
				} else {
					// kropp
					ctx.fillStyle = snake.colorBody;
					ctx.fill();
				}
			});
		}
	}
}
