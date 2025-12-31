import { loadHighscores, saveHighscore, qualifiesForTop10 } from "./HighscoreStore.js";

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

		// Multiplayer callbacks (MultiplayerController sätter dessa)
		this.onMpHostRequest = null;
		this.onMpJoinRequest = null;
		this.onMpReadyToggle = null;
		this.onMpLeave = null;

		// Highscore highlight
		this._highlightId = null;

		this._ensureArcadeStyles();

		// ✅ Match timer HUD (always visible during match)
		this.matchTimerEl = this._ensureMatchTimerHud();

		this.startButton?.addEventListener("click", () => {
			this.hideStartScreen();
			this.game.startGame();
		});

		this.restartButton?.addEventListener("click", () => {
			this.hideDeathScreen();
			this.game.startGame();
		});

		this.multiplayerButton?.addEventListener("click", () => {
			this.showLobby();
		});

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
			void this._onSingleplayerDeath(score);
		});

		void this.renderHighscores();
	}

	async _onSingleplayerDeath(score) {
		this.showDeathScreen(score);

		try {
			const ok = await qualifiesForTop10(score);
			if (ok) {
				const initials = await this._showArcadeInitialsEntry(score);
				const { insertedId } = await saveHighscore(score, initials);
				this._highlightId = insertedId;
			}
		} catch {
			// ignore
		}

		await this.renderHighscores();
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

	async renderHighscores() {
		if (!this.highscoreList) return;

		const highscores = await loadHighscores();

		this.highscoreList.innerHTML = highscores.length
			? highscores
					.map((h, i) => {
						const rank = i + 1;
						const name = escapeHtml(h.initials ?? "---");
						const date = escapeHtml(h.date ?? "");
						const score = Number(h.score ?? 0);
						const isMe = this._highlightId && h.id === this._highlightId;

						return `<li class="hs-row ${isMe ? "hs-me" : ""}">
  <span class="hs-rank">${rank}.</span>
  <span class="hs-name">${name}</span>
  <span class="hs-score">${score}</span>
  <span class="hs-date">${date}</span>
</li>`;
					})
					.join("")
			: `<li style="opacity:.7">No scores yet</li>`;

		if (this._highlightId) {
			const el = this.highscoreList.querySelector(".hs-me");
			el?.scrollIntoView({ block: "center", behavior: "smooth" });
		}
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

	// ✅ Match timer HUD (visible during match)
	setMatchTimer(text) {
		if (!this.matchTimerEl) return;
		const t = String(text ?? "").trim();
		this.matchTimerEl.textContent = t ? `⏱ ${t}` : "";
		this.matchTimerEl.style.display = t ? "block" : "none";
	}

	// Winner UI
	showWinnerBoard({ winnerName, scores }) {
		this.hideLobby();
		this.hideDeathScreen();

		// Clear match timer when winner screen shows
		this.setMatchTimer("");

		if (this.winnerTitleEl) {
			const w = String(winnerName ?? "").trim();
			if (!w) this.winnerTitleEl.textContent = "Winner";
			else if (w === "Tie") this.winnerTitleEl.textContent = "Tie!";
			else this.winnerTitleEl.textContent = `Winner: ${w}`;
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

	// === Arcade initials overlay ===
	_showArcadeInitialsEntry(score) {
		return new Promise((resolve) => {
			const overlay = document.createElement("div");
			overlay.className = "arcade-overlay";

			overlay.innerHTML = `
<div class="arcade-card">
  <div class="arcade-title">NEW HIGH SCORE</div>
  <div class="arcade-sub">Score: <span class="arcade-score">${Number(score)}</span></div>
  <div class="arcade-hint">ENTER INITIALS</div>
  <div class="arcade-inputs">
    <input class="arcade-char" inputmode="latin" maxlength="1" autocomplete="off" placeholder="A" />
    <input class="arcade-char" inputmode="latin" maxlength="1" autocomplete="off" placeholder="A" />
    <input class="arcade-char" inputmode="latin" maxlength="1" autocomplete="off" placeholder="A" />
  </div>
  <div class="arcade-help">A–Z / 0–9 • Enter to confirm</div>
</div>`;

			document.body.appendChild(overlay);

			const inputs = Array.from(overlay.querySelectorAll(".arcade-char"));
			const sanitizeChar = (ch) => String(ch ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

			const commit = () => {
				const initials =
					inputs.map((i) => sanitizeChar(i.value)).join("").padEnd(3, "A").slice(0, 3) || "AAA";
				overlay.remove();
				resolve(initials);
			};

			inputs.forEach((inp, idx) => {
				inp.addEventListener("focus", () => inp.select());

				inp.addEventListener("input", () => {
					inp.value = sanitizeChar(inp.value).slice(0, 1);

					if (inp.value && idx < inputs.length - 1) {
						inputs[idx + 1].focus();
						inputs[idx + 1].select();
					}
				});

				inp.addEventListener("keydown", (e) => {
					if (e.key === "Backspace" && !inp.value && idx > 0) {
						e.preventDefault();
						inputs[idx - 1].focus();
						inputs[idx - 1].select();
						return;
					}
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
					}
				});
			});

			inputs[0].value = "";
			inputs[1].value = "";
			inputs[2].value = "";
			inputs[0].focus();
			inputs[0].select();
		});
	}

	_ensureArcadeStyles() {
		if (document.getElementById("arcade-style")) return;
		const style = document.createElement("style");
		style.id = "arcade-style";
		style.textContent = `
.arcade-overlay{
  position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
  background:rgba(0,0,0,0.72); z-index:9999;
}
.arcade-card{
  width:min(420px, 92vw);
  border:1px solid rgba(0,255,255,0.25);
  box-shadow:0 0 28px rgba(0,255,255,0.18);
  background:rgba(8,10,12,0.92);
  padding:18px 18px 14px;
  text-align:center;
}
.arcade-title{
  letter-spacing:2px; font-weight:800; font-size:18px; opacity:.95;
}
.arcade-sub{ margin-top:8px; opacity:.85; }
.arcade-hint{ margin-top:14px; letter-spacing:2px; opacity:.9; font-size:12px; }
.arcade-inputs{ margin-top:10px; display:flex; gap:10px; justify-content:center; }
.arcade-char{
  width:52px; height:58px; text-align:center;
  font-size:32px; font-weight:800; letter-spacing:1px;
  color:rgba(220,255,255,0.95);
  background:rgba(0,255,255,0.06);
  border:1px solid rgba(0,255,255,0.25);
  outline:none;
}
.arcade-char::placeholder{
  color:rgba(220,255,255,0.35);
}
.arcade-char:focus{
  border-color:rgba(255,255,255,0.45);
  box-shadow:0 0 16px rgba(0,255,255,0.22);
}
.arcade-help{ margin-top:10px; font-size:12px; opacity:.65; }

.hs-row{ display:flex; gap:10px; align-items:baseline; }
.hs-rank{ width:38px; opacity:.75; }
.hs-name{ width:64px; font-weight:700; letter-spacing:1px; }
.hs-score{ width:80px; }
.hs-date{ opacity:.55; margin-left:auto; }
.hs-me{
  background:rgba(0,255,255,0.12);
  outline:1px solid rgba(0,255,255,0.22);
  box-shadow:0 0 16px rgba(0,255,255,0.10);
}
`;
		document.head.appendChild(style);
	}

	// ✅ Create a small HUD timer (so it shows even when lobby is hidden)
	_ensureMatchTimerHud() {
		const existing = document.getElementById("matchTimerHud");
		if (existing) return existing;

		const el = document.createElement("div");
		el.id = "matchTimerHud";
		el.textContent = "";
		el.style.position = "fixed";
		el.style.top = "10px";
		el.style.right = "12px";
		el.style.zIndex = "9998";
		el.style.padding = "8px 10px";
		el.style.borderRadius = "10px";
		el.style.border = "1px solid rgba(0,255,255,0.25)";
		el.style.background = "rgba(8,10,12,0.70)";
		el.style.boxShadow = "0 0 18px rgba(0,255,255,0.12)";
		el.style.fontWeight = "800";
		el.style.letterSpacing = "1px";
		el.style.fontSize = "14px";
		el.style.color = "rgba(220,255,255,0.95)";
		el.style.display = "none";
		el.style.userSelect = "none";
		el.style.pointerEvents = "none";

		document.body.appendChild(el);
		return el;
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
