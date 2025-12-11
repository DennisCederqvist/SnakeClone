// UiManager.js – hanterar startskärm (och senare paus/redo, game over osv)

export class UiManager {
	constructor(game) {
		this.game = game;

		this.startScreen = document.getElementById("startScreen");
		this.startButton = document.getElementById("startButton");

		if (this.startButton) {
			this.startButton.addEventListener("click", () => {
				this.hideStartScreen();
				this.game.startGame();
			});
		}
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
}
