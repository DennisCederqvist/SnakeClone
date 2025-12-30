import { Game } from "./Game.js";
import { UiManager } from "./UiManager.js";
import { MultiplayerController } from "./MultiplayerController.js";

const MPAPI_SERVER_URL = "wss://mpapi.se/net";
const MPAPI_IDENTIFIER = "0a8abcce-a4e7-4b30-a2f6-e57253a895b5";

function isTypingTarget(el) {
	if (!el) return false;
	const tag = (el.tagName || "").toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") return true;
	if (el.isContentEditable) return true;
	return false;
}

function initiate() {
	const canvas = document.getElementById("gameCanvas");
	const scoreElement = document.getElementById("score");

	const game = new Game(canvas, scoreElement);
	const ui = new UiManager(game);

	// ✅ Multiplayer "motor" + UI callbacks kopplas här
	const mp = new MultiplayerController(game, ui, {
		serverUrl: MPAPI_SERVER_URL,
		identifier: MPAPI_IDENTIFIER,
	});

	window.addEventListener("keydown", (event) => {
		// Om användaren skriver i ett inputfält: låt WASD fungera normalt (skriv text)
		if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) {
			// Men låt Arrow keys fungera normalt också i inputs (caret navigation)
			return;
		}

		const k = event.key;

		// Arrow keys + WASD (case-insensitive)
		const allowed = new Set([
			"ArrowUp",
			"ArrowDown",
			"ArrowLeft",
			"ArrowRight",
			"w",
			"a",
			"s",
			"d",
			"W",
			"A",
			"S",
			"D",
		]);

		if (!allowed.has(k)) return;

		// Förhindra scroll på piltangenter (WASD har ingen browser-default att stoppa)
		if (k.startsWith("Arrow")) event.preventDefault();

		// ✅ Route input: multiplayer när aktivt, annars singleplayer
		if (mp.isMultiplayerActive()) mp.handleKeyDown(k);
		else game.handleKeyDown(k);
	});
}

window.addEventListener("load", () => {
	initiate();
});


const bgm = document.getElementById("bgm");
const soundBtn = document.getElementById("soundToggle");

let soundEnabled = false;

// Förbered ljudet (laddas direkt av preload)
bgm.volume = 0.25;
bgm.muted = true;

soundBtn.addEventListener("click", async () => {
	try {
		if (!soundEnabled) {
			// Första tillåtna play() (user gesture)
			bgm.muted = false;
			await bgm.play();
			soundBtn.textContent = "🔊";
			soundEnabled = true;
		} else {
      // bgm.muted = true;
			bgm.pause();
			soundBtn.textContent = "🔇";
			soundEnabled = false;
		}
	} catch (e) {
		console.error("Audio playback failed:", e);
	}
});
