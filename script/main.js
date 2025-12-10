// main.js – bootstrap: kopplar ihop DOM, input och Game

import { Game } from "./game.js";

window.addEventListener("load", () => {
	const canvas = document.getElementById("gameCanvas");
	const scoreElement = document.getElementById("score");

	const game = new Game(canvas, scoreElement);

	// Tangentbordsstyrning – utan att scrolla sidan
	window.addEventListener("keydown", (event) => {
		const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

		if (arrowKeys.includes(event.key)) {
			event.preventDefault();
			game.handleKeyDown(event.key);
		} else if (event.key === " ") {
			// Space → speedboost
			event.preventDefault();
			game.handleKeyDown("Space");
		}
	});

	window.addEventListener("keyup", (event) => {
		if (event.key === " ") {
			event.preventDefault();
			game.handleKeyUp("Space");
		}
	});
});
