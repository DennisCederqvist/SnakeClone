import { Game } from "./Game.js";
import { UiManager } from "./UiManager.js";
import { MultiplayerController } from "./MultiplayerController.js";

const MPAPI_SERVER_URL = "wss://mpapi.se/net";
const MPAPI_IDENTIFIER = "0a8abcce-a4e7-4b30-a2f6-e57253a895b5";

function initiate() {
  const canvas = document.getElementById("gameCanvas");
  const scoreElement = document.getElementById("score");

  const game = new Game(canvas, scoreElement);
  const ui = new UiManager(game);

  // Multiplayer controller (host-authoritative)
  const mp = new MultiplayerController(game, ui, {
    serverUrl: MPAPI_SERVER_URL,
    identifier: MPAPI_IDENTIFIER,
  });

  window.addEventListener("keydown", (event) => {
    const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (!arrowKeys.includes(event.key)) return;

    event.preventDefault();

    if (mp.isMultiplayerActive()) {
      mp.handleKeyDown(event.key);
    } else {
      game.handleKeyDown(event.key);
    }
  });
}

window.addEventListener("load", () => {
  initiate();
});
