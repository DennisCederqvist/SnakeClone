// UiManager.js – hanterar startskärm, game over och highscores

import { loadHighscores, saveHighscore } from "./HighscoreStore.js";

export class UiManager {
	constructor(game) {
		this.game = game;

		// === STARTSKÄRM ===
		this.startScreen = document.getElementById("startScreen");
		this.startButton = document.getElementById("startButton");
		this.highscoreList = document.getElementById("highscoreList");

		if (this.startButton) {
			this.startButton.addEventListener("click", () => {
				this.hideStartScreen();
				this.game.startGame();
			});
		}

		// === GAME OVER ===
		this.deathScreen = document.getElementById("deathScreen");
		this.finalScoreEl = document.getElementById("finalScore");
		this.restartButton = document.getElementById("restartButton");

		if (this.restartButton) {
			this.restartButton.addEventListener("click", () => {
				this.hideDeathScreen();
				this.game.startGame();
			});
		}

		// === KOPPLA GAME → UI ===
		this.game.setOnPlayerDeath(({ score }) => {
			saveHighscore(score);
			this.renderHighscores();
			this.showDeathScreen(score);
		});

		// Visa highscores direkt när sidan laddas
		this.renderHighscores();
	}

	// =========================
	// START SCREEN
	// =========================

	showStartScreen() {
		if (this.startScreen) {
			this.startScreen.classList.remove("hidden");
		}
	}

	hideStartScreen() {
		if (this.startScreen) {
			this.startScreen.classList.add("hidden");
		}
	}

	// =========================
	// GAME OVER
	// =========================

	showDeathScreen(score) {
		if (this.finalScoreEl) {
			this.finalScoreEl.textContent = String(score);
		}
		if (this.deathScreen) {
			this.deathScreen.classList.remove("hidden");
		}
	}

	hideDeathScreen() {
		if (this.deathScreen) {
			this.deathScreen.classList.add("hidden");
		}
	}

	// =========================
	// HIGHSCORES
	// =========================

	renderHighscores() {
		if (!this.highscoreList) return;

		const highscores = loadHighscores();

		this.highscoreList.innerHTML = highscores.length
			? highscores
					.map(
						(h) =>
							`<li>${h.score} <span style="opacity:.6">(${h.date})</span></li>`
					)
					.join("")
			: `<li style="opacity:.7">No scores yet</li>`;
	}
}
