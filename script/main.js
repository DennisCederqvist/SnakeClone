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

// === AUDIO (BGM toggle + SFX always-on) ===
function setupAudio() {
	const SOUND_KEY = "trake_sound_enabled"; // BGM only
	const bgm = document.getElementById("bgm");
	const soundBtn = document.getElementById("soundToggle");

 // === BGM PLAYLIST ===
if (bgm) bgm.loop = false; // safety in case loop is still present in HTML

const bgmPlaylist = [
	"assets/musik/Trake(extended).mp3",
	"assets/musik/ElectricPulse.mp3",
	"assets/musik/ElectricPulse2.mp3",
	"assets/musik/PixelCarnage.mp3",
	"assets/musik/PixelVenom.mp3",
	"assets/musik/PixelVenom2.mp3",
];

let bgmIndex = Math.floor(Math.random() * bgmPlaylist.length);

function setBgmTrack(i) {
	if (!bgm || !bgmPlaylist.length) return;
	bgmIndex = ((i % bgmPlaylist.length) + bgmPlaylist.length) % bgmPlaylist.length;
	bgm.src = bgmPlaylist[bgmIndex];
	bgm.load();
}

function nextRandomIndex(current, length) {
		if (length <= 1) return current;
		let next;
		do {
			next = Math.floor(Math.random() * length);
		} while (next === current);
		return next;
	}

setBgmTrack(bgmIndex);

// NOTE: wantsBgm() is defined later in your setupAudio(), that's fine.
// This handler will only run after setupAudio() has completed.
if (bgm) {
	bgm.addEventListener("ended", async () => {
		if (!wantsBgm()) return;
		setBgmTrack(nextRandomIndex(bgmIndex, bgmPlaylist.length));
		try { await bgm.play(); } catch {}
	});
}

  //SFX registration

	const sfx = {
		boob: document.getElementById("sfxBoob"),
		crash: document.getElementById("sfxCrash"),
		yum: document.getElementById("sfxYum"),
		zoom: document.getElementById("sfxZoom"),

    speed: document.getElementById("sfxSpeed"),
    mirrored: document.getElementById("sfxMirrored"),
    plus100: document.getElementById("sfxPlus100"),
    ghosting: document.getElementById("sfxGhosting"),
	};

	// Warn if missing, but don't crash
	for (const [k, el] of Object.entries(sfx)) {
		if (!el) console.warn(`[SFX] Missing audio element: ${k}`);
	}
	if (!bgm) console.warn("[BGM] Missing audio element: bgm");
	if (!soundBtn) console.warn("[BGM] Missing button: soundToggle");

	// Volumes
	if (sfx.boob) sfx.boob.volume = 0.55;
	if (sfx.crash) sfx.crash.volume = 0.8;
	if (sfx.yum) sfx.yum.volume = 0.7;
	if (sfx.zoom) sfx.zoom.volume = 0.8;

  if (sfx.speed) sfx.speed.volume = 0.85;
  if (sfx.mirrored) sfx.mirrored.volume = 0.85;
  if (sfx.plus100) sfx.plus100.volume = 0.9;
  if (sfx.ghosting) sfx.ghosting.volume = 0.85;

	if (bgm) bgm.volume = 0.14;

	const setButton = (enabled) => {
		if (!soundBtn) return;
		soundBtn.textContent = enabled ? "🔊" : "🔇";
	};

	// Default behavior:
	// - If user has NEVER set the key => treat as ON (not manually muted)
	// - If key is "0" => user muted
	// - If key is "1" => user wants music
	const wantsBgm = () => {
		const raw = localStorage.getItem(SOUND_KEY);
		return raw === null ? true : raw === "1";
	};

	const setBgmPreference = (enabled) => {
		localStorage.setItem(SOUND_KEY, enabled ? "1" : "0");
		setButton(enabled);
	};

	const tryStartBgm = async () => {
		if (!bgm) return false;
		try {
			bgm.muted = false;
			await bgm.play();
			return true;
		} catch {
			return false;
		}
	};

	// SFX should NOT depend on BGM state
	let sfxPrimed = false;
	const primeSfx = async () => {
		if (sfxPrimed) return;
		sfxPrimed = true;

		const audios = Object.values(sfx).filter(Boolean);
		for (const a of audios) {
			try {
				const prevMuted = a.muted;
				a.muted = true;
				a.currentTime = 0;
				await a.play();
				a.pause();
				a.currentTime = 0;
				a.muted = prevMuted;
			} catch {
				sfxPrimed = false;
				return;
			}
		}
	};

	let lastBoobAt = 0;
	window.__trakeSfx = {
		play(name) {
			const a = sfx[name];
			if (!a) return;

			if (name === "boob") {
				const now = performance.now();
				if (now - lastBoobAt < 90) return;
				lastBoobAt = now;
			}

			try {
				a.currentTime = 0;
				a.play().catch(() => {});
			} catch {}
		},
		prime: primeSfx,
	};

	// Prime SFX on first real gesture
	const primeOnGesture = () => void primeSfx();
	window.addEventListener("pointerdown", primeOnGesture, { capture: true });
	window.addEventListener("keydown", primeOnGesture, { capture: true });

	// === BGM init + toggle ===
	if (bgm && soundBtn) {
		if (wantsBgm()) {
			setButton(true);
			bgm.muted = false;
			void tryStartBgm(); // may be blocked until gesture
		} else {
			setButton(false);
			bgm.muted = true;
			bgm.pause();
		}

		soundBtn.addEventListener("click", async () => {
			if (!wantsBgm()) {
				// turn ON
				setBgmPreference(true);
				bgm.muted = false;
				await tryStartBgm();
			} else {
				// turn OFF
				setBgmPreference(false);
				bgm.pause();
				bgm.muted = true;
			}
		});
	}

	// ✅ Start BGM on clicking Singleplayer/Multiplayer if user has NOT muted it.
	// Works even if buttons are created dynamically or IDs differ.
	document.addEventListener(
		"click",
		(e) => {
			if (!bgm) return;
			if (!wantsBgm()) return;

			const btn = e.target?.closest?.("button");
			if (!btn) return;

			// If user is typing in an input, ignore
			if (isTypingTarget(document.activeElement)) return;

			const id = (btn.id || "").toLowerCase();
			const txt = (btn.textContent || "").trim().toLowerCase();

			const looksLikeStart =
				id.includes("single") ||
				id.includes("multi") ||
				txt.includes("singleplayer") ||
				txt.includes("single player") ||
				txt.includes("multiplayer") ||
				txt.includes("multi player");

			if (!looksLikeStart) return;

			// Start immediately on this gesture
			bgm.muted = false;
			bgm.play().catch(() => {});
		},
		true
	);

	// If key was never set, store default ON once (so UI is consistent across reloads)
	if (localStorage.getItem(SOUND_KEY) === null) {
		localStorage.setItem(SOUND_KEY, "1");
		if (soundBtn) setButton(true);
	}
}

function initiate() {
	const canvas = document.getElementById("gameCanvas");
	const scoreElement = document.getElementById("score");

	const game = new Game(canvas, scoreElement);
	const ui = new UiManager(game);

	const mp = new MultiplayerController(game, ui, {
		serverUrl: MPAPI_SERVER_URL,
		identifier: MPAPI_IDENTIFIER,
	});

	const dirKeys = new Set([
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

	window.addEventListener("keydown", (event) => {
		if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;

		const k = event.key;
		if (!dirKeys.has(k)) return;

		// Prevent scroll on arrow keys
		if (k.startsWith("Arrow")) event.preventDefault();

		// SFX turn sound
		window.__trakeSfx?.play("boob");

		if (mp.isMultiplayerActive()) mp.handleKeyDown(k);
		else game.handleKeyDown(k);
	});
}

window.addEventListener("load", () => {
	setupAudio();
	initiate();
});
