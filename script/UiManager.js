import { loadHighscores, saveHighscore } from "./HighscoreStore.js";

export class UiManager {
  constructor(game) {
    this.game = game;

    this.startScreen = document.getElementById("startScreen");
    this.startButton = document.getElementById("startButton");
    this.multiplayerButton = document.getElementById("multiplayerButton");
    this.highscoreList = document.getElementById("highscoreList");

    this.deathScreen = document.getElementById("deathScreen");
    this.finalScoreEl = document.getElementById("finalScore");
    this.restartButton = document.getElementById("restartButton");

    // Lobby
    this.lobbyScreen = document.getElementById("lobbyScreen");
    this.lobbyCodeEl = document.getElementById("lobbyCode");
    this.playerNameInput = document.getElementById("playerNameInput");
    this.joinCodeInput = document.getElementById("joinCodeInput");
    this.hostLobbyButton = document.getElementById("hostLobbyButton");
    this.joinLobbyButton = document.getElementById("joinLobbyButton");
    this.readyButton = document.getElementById("readyButton");
    this.leaveLobbyButton = document.getElementById("leaveLobbyButton");
    this.lobbyPlayersList = document.getElementById("lobbyPlayersList");
    this.countdownEl = document.getElementById("countdown");

    // Winner
    this.winnerScreen = document.getElementById("winnerScreen");
    this.winnerTitleEl = document.getElementById("winnerTitle");
    this.winnerListEl = document.getElementById("winnerList");
    this.winnerSingleButton = document.getElementById("winnerSingleButton");
    this.winnerMultiButton = document.getElementById("winnerMultiButton");

    // Callbacks (MultiplayerController sätter dessa)
    this.onMpHostRequest = null;
    this.onMpJoinRequest = null;
    this.onMpReadyToggle = null;
    this.onMpLeave = null;

    // Singleplayer start
    this.startButton?.addEventListener("click", () => {
      this.hideStartScreen();
      this.game.startGame();
    });

    // Singleplayer restart
    this.restartButton?.addEventListener("click", () => {
      this.hideDeathScreen();
      this.game.startGame();
    });

    // Multiplayer: öppna lobby
    this.multiplayerButton?.addEventListener("click", () => {
      this.showLobby();
    });

    // Lobby: host/join/ready/leave
    this.hostLobbyButton?.addEventListener("click", () => {
      const name = this.getPlayerName();
      this.onMpHostRequest?.(name);
    });

    this.joinLobbyButton?.addEventListener("click", () => {
      const code = (this.joinCodeInput?.value ?? "").trim();
      const name = this.getPlayerName();
      this.onMpJoinRequest?.(code, name);
    });

    this.readyButton?.addEventListener("click", () => {
      this.onMpReadyToggle?.();
    });

    this.leaveLobbyButton?.addEventListener("click", () => {
      this.onMpLeave?.();
    });

    // Winner buttons
    this.winnerSingleButton?.addEventListener("click", () => {
      this.hideWinner();
      this.showStartScreen();
    });

    this.winnerMultiButton?.addEventListener("click", () => {
      this.hideWinner();
      this.showLobby();
    });

    // Singleplayer death hook
    this.game.setOnPlayerDeath(({ score }) => {
      saveHighscore(score);
      this.renderHighscores();
      this.showDeathScreen(score);
    });

    this.renderHighscores();
  }

  getPlayerName() {
    const raw = (this.playerNameInput?.value ?? "").trim();
    return raw || "Player";
  }

  showStartScreen() {
    this.startScreen?.classList.remove("hidden");
  }
  hideStartScreen() {
    this.startScreen?.classList.add("hidden");
  }

  showDeathScreen(score) {
    if (this.finalScoreEl) this.finalScoreEl.textContent = String(score);
    this.deathScreen?.classList.remove("hidden");
  }
  hideDeathScreen() {
    this.deathScreen?.classList.add("hidden");
  }

  renderHighscores() {
    if (!this.highscoreList) return;

    const highscores = loadHighscores();
    this.highscoreList.innerHTML = highscores.length
      ? highscores
          .map((h) => `<li>${h.score} <span style="opacity:.6">(${h.date})</span></li>`)
          .join("")
      : `<li style="opacity:.7">No scores yet</li>`;
  }

  // Lobby UI
  showLobby() {
    this.hideDeathScreen();
    this.hideWinner();
    this.hideStartScreen();
    this.lobbyScreen?.classList.remove("hidden");
  }
  hideLobby() {
    this.lobbyScreen?.classList.add("hidden");
  }

  setLobbyCode(code) {
    if (this.lobbyCodeEl) this.lobbyCodeEl.textContent = code ? String(code) : "";
  }

  setLobbyPlayers(players) {
    if (!this.lobbyPlayersList) return;
    this.lobbyPlayersList.innerHTML = players
      .map((p) => {
        const badge = p.isHost ? " (HOST)" : "";
        const r = p.ready ? "✅" : "⏳";
        return `<li>${r} ${escapeHtml(p.name ?? "Player")}${badge}</li>`;
      })
      .join("");
  }

  setReadyButtonState(isReady) {
    if (!this.readyButton) return;
    this.readyButton.textContent = isReady ? "Unready" : "Ready";
  }

  setCountdown(text) {
    if (!this.countdownEl) return;
    this.countdownEl.textContent = text ?? "";
  }

  // Winner UI
  showWinnerBoard({ winnerName, scores }) {
    this.hideLobby();
    this.hideDeathScreen();

    if (this.winnerTitleEl) {
      this.winnerTitleEl.textContent = winnerName ? `Winner: ${winnerName}` : "Winner";
    }

    if (this.winnerListEl) {
      this.winnerListEl.innerHTML = (scores ?? [])
        .slice()
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .map((s) => `<li>${escapeHtml(s.name)} — ${Number(s.score ?? 0)}</li>`)
        .join("");
    }

    this.winnerScreen?.classList.remove("hidden");
  }

  hideWinner() {
    this.winnerScreen?.classList.add("hidden");
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
