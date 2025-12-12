// UiManager.js – hanterar startskärm och game over (senare: multiplayer UI)

export class UiManager {
	constructor(game) {
		this.game = game;

		// Startskärm
		this.startScreen = document.getElementById("startScreen");
		this.startButton = document.getElementById("startButton");

		if (this.startButton) {
			this.startButton.addEventListener("click", () => {
				this.hideStartScreen();
				this.game.startGame();
			});
		}

		// Game Over-skärm
		this.deathScreen = document.getElementById("deathScreen");
		this.finalScoreEl = document.getElementById("finalScore");
		this.restartButton = document.getElementById("restartButton");

		if (this.restartButton) {
			this.restartButton.addEventListener("click", () => {
				this.hideDeathScreen();
				this.game.startGame();
			});
		}

		// Koppla game → UI (när spelaren dör)
		this.game.setOnPlayerDeath(({ score }) => {
			this.showDeathScreen(score);
		});
	}

	hideStartScreen() {
		if (this.startScreen) {
			this.startScreen.classList.add("hidden");
		}
	}

	showStartScreen() {
		if (this.startScreen) {
			this.startScreen.classList.remove("hidden");
		}
	}

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
}
