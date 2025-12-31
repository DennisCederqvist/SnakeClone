// MultiplayerController.js
// Host-authoritative multiplayer + smooth rendering for joiners.
//
// ✅ Additions in this drop-in:
// - Tie-breaker: if top score is tied => "Oavgjort" (deterministic).
// - Match timer (mm:ss) shown during running match (HUD in UI).
//
// Keeps:
// - Lobby overlay visible during countdown; hides when match starts.
// - Winner buttons: Single => leave + start singleplayer, Multi => rematch same session.

import { mpapi } from "./mpapi.js";
import { Snake } from "./Snake.js";
import {
  GRID_COLS,
  GRID_ROWS,
  FOOD_COUNT,
  POWERUP_COUNT,
  EFFECT,
} from "./Config.js";
import { PowerUpType } from "./PowerUps.js";

const MAX_PLAYERS = 4;

// Logic tick
const TICK_MS = 100; // 10 ticks/s

// Render smoothing (joiners)
const OTHERS_RENDER_DELAY_MS = 160; // smooth remote jitter
const SELF_RENDER_DELAY_MS = 50;     // reduce perceived input lag

// ✅ how far we allow self extrapolation past newest snapshot (in ticks)
const SELF_MAX_EXTRAP_TICKS = 0.9;

const MATCH_DURATION_MS = 120_000; // 3 min
const RESPAWN_DELAY_MS = 3_000;
const COUNTDOWN_MS = 3_000;

const MATCH_DURATION_TICKS = Math.ceil(MATCH_DURATION_MS / TICK_MS);
const RESPAWN_DELAY_TICKS = Math.ceil(RESPAWN_DELAY_MS / TICK_MS);
const COUNTDOWN_TICKS = Math.ceil(COUNTDOWN_MS / TICK_MS);

const SLOT_COLORS = [
  { body: "#00ffff", glow: "rgba(0,255,255,0.35)" }, // host cyan
  { body: "#ffd400", glow: "rgba(255,212,0,0.35)" }, // yellow
  { body: "#ff3b30", glow: "rgba(255,59,48,0.35)" }, // red
  { body: "#ff4fd8", glow: "rgba(255,79,216,0.35)" }, // pink
];

function getSlotSpawn(slot, cols, rows) {
  const left = 1;
  const top = 1;
  const right = cols - 2;
  const bottom = rows - 2;

  switch (slot) {
    case 0: return { x: left, y: top, dir: { x: 1, y: 0 } };
    case 1: return { x: right, y: top, dir: { x: -1, y: 0 } };
    case 2: return { x: right, y: bottom, dir: { x: -1, y: 0 } };
    case 3: return { x: left, y: bottom, dir: { x: 1, y: 0 } };
    default: return { x: left, y: top, dir: { x: 1, y: 0 } };
  }
}

// Deterministic RNG (host only)
class RNG {
  constructor(seed) { this._seed = seed >>> 0; }
  nextU32() {
    this._seed = (1664525 * this._seed + 1013904223) >>> 0;
    return this._seed;
  }
  int(min, maxInclusive) {
    const span = maxInclusive - min + 1;
    return min + (this.nextU32() % span);
  }
  pick(arr) {
    if (!arr.length) return null;
    return arr[this.int(0, arr.length - 1)];
  }
}

export class MultiplayerController {
  constructor(game, ui, opts) {
    this.game = game;
    this.ui = ui;

    this.serverUrl = opts.serverUrl;
    this.identifier = opts.identifier;

    this.cols = GRID_COLS;
    this.rows = GRID_ROWS;

    this.api = new mpapi(this.serverUrl, this.identifier);
    this.unlisten = null;

    // Session
    this.isActive = false;
    this.isHost = false;
    this.sessionId = null;
    this.selfId = null;
    this.selfName = "Player";

    // Lobby/roster
    this.rosterIds = [];
    this.players = new Map(); // id -> {name,ready,score,isHost}
    this.runtime = new Map(); // id -> runtime (host sim)
    this.localReady = false;

    // Match state
    this.matchState = "idle"; // idle | lobby | countdown | running | ended
    this.tick = 0;
    this.countdownStartTick = null;
    this.matchStartTick = null;
    this.matchEndTick = null;

    // World (host truth)
    this.seed = (Date.now() ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
    this.rng = new RNG(this.seed);
    this.foods = [];
    this.powerUps = [];

    // Snapshot buffer (clients render from this)
    // Each: { tick, receivedAt, snapshot }
    this._snapBuf = [];

    // Anchor for estimating host tick now (client-side)
    this._lastSnapTick = 0;
    this._lastSnapAt = 0;

    this._othersDelayTicks = Math.max(1, Math.round(OTHERS_RENDER_DELAY_MS / TICK_MS));
    this._selfDelayTicks = Math.max(0, Math.round(SELF_RENDER_DELAY_MS / TICK_MS));

    // Loops
    this._rafId = null;
    this._lastRaf = null;
    this._tickAcc = 0;

    this._attachUiCallbacks();
    this._attachWinnerOverrides();
    this._attachNetworkListener();
  }

  _attachUiCallbacks() {
    this.ui.onMpHostRequest = async (name) => this.hostLobby(name);
    this.ui.onMpJoinRequest = async (code, name) => this.joinLobby(code, name);
    this.ui.onMpReadyToggle = () => this.toggleReady();
    this.ui.onMpLeave = () => this.leave();
  }

  _attachWinnerOverrides() {
    const singleBtn = this.ui.winnerSingleButton;
    const multiBtn = this.ui.winnerMultiButton;

    singleBtn?.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();

        this.leave(true);
        this.ui.hideWinner();
        this.ui.hideStartScreen();
        this.game.startGame();
      },
      { capture: true }
    );

    multiBtn?.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();

        this._rematchToLobbySameSession();
      },
      { capture: true }
    );
  }

  _attachNetworkListener() {
    if (this.unlisten) this.unlisten();
    this.unlisten = this.api.listen((cmd, _messageId, clientId, data) => {
      if (!this.isActive) return;

      if (cmd === "joined") return this._onPeerJoined(clientId);
      if (cmd === "left") return this._onPeerLeft(clientId);
      if (cmd === "closed") return this._onClosed();
      if (cmd === "game") return this._onGameMessage(clientId, data);
    });
  }

  isMultiplayerActive() {
    return this.isActive;
  }

  handleKeyDown(key) {
    const dir = keyToDir(key);
    if (!dir) return;

    const rt = this.runtime.get(this.selfId);
    if (rt) rt.desiredDir = dir;

    this.api.transmit({ type: "input", tick: this.tick, dir });
  }

  // --------------------
  // Lobby flow
  // --------------------
  async hostLobby(name) {
    this._resetAllState();
    this.isActive = true;
    this.isHost = true;
    this.matchState = "lobby";

    this.selfName = name || "Player";
    this.game.setRenderEnabled(false);

    try {
      const res = await this.api.host({ name: this.selfName });
      this.sessionId = res.session;
      this.selfId = res.clientId;

      this.rosterIds = [this.selfId];
      this.players.set(this.selfId, {
        name: this.selfName,
        ready: false,
        score: 0,
        isHost: true,
      });

      this._ensureRuntimeFor(this.selfId);
      this._rebuildWorldHost();

      this.ui.setLobbyCode(this.sessionId);
      this.ui.showLobby();
      this._renderLobbyPlayers();

      this.api.transmit({ type: "hello", name: this.selfName });
      this._broadcastRoster();

      this._startLoops();
    } catch (e) {
      console.error("hostLobby failed:", e);
      this.leave(true);
    }
  }

  async joinLobby(code, name) {
    this._resetAllState();
    this.isActive = true;
    this.isHost = false;
    this.matchState = "lobby";

    this.selfName = name || "Player";
    this.game.setRenderEnabled(false);

    try {
      const payload = await this.api.join(code, { name: this.selfName });
      this.sessionId = payload.session;
      this.selfId = payload.clientId;

      const ids = [];
      if (payload.host) ids.push(payload.host);
      if (Array.isArray(payload.clients)) ids.push(...payload.clients);
      if (payload.clientId) ids.push(payload.clientId);

      this.rosterIds = dedupe(ids).slice(0, MAX_PLAYERS);

      for (const id of this.rosterIds) {
        if (!this.players.has(id)) {
          this.players.set(id, {
            name: id === this.selfId ? this.selfName : "Player",
            ready: false,
            score: 0,
            isHost: id === payload.host,
          });
        }
        this._ensureRuntimeFor(id);
      }

      this.ui.setLobbyCode(this.sessionId);
      this.ui.showLobby();
      this._renderLobbyPlayers();

      this.api.transmit({ type: "hello", name: this.selfName });

      this._startLoops();
    } catch (e) {
      console.error("joinLobby failed:", e);
      this.leave(true);
    }
  }

  toggleReady() {
    if (!this.isActive) return;

    this.localReady = !this.localReady;
    const me = this.players.get(this.selfId);
    if (me) me.ready = this.localReady;

    this.ui.setReadyButtonState(this.localReady);
    this._renderLobbyPlayers();

    this.api.transmit({ type: "ready", ready: this.localReady });

    if (this.isHost) this._tryStartCountdownIfAllReady();
  }

  leave(silent = false) {
    if (!silent) console.log("Leaving multiplayer…");

    try { this.api.leave(); } catch {}

    this._stopLoops();
    this.game.setRenderEnabled(true);

    this._resetAllState();

    this.ui.setCountdown("");
    this.ui.setMatchTimer(""); // ✅ clear HUD timer
    this.ui.setLobbyPlayers([]);
    this.ui.setLobbyCode("");
    this.ui.hideLobby();
    this.ui.hideWinner();
    this.ui.showStartScreen();
  }

  _rematchToLobbySameSession() {
    if (!this.isActive) {
      this.ui.hideWinner();
      this.ui.showLobby();
      return;
    }

    this.matchState = "lobby";
    this.countdownStartTick = null;
    this.matchStartTick = null;
    this.matchEndTick = null;

    this.ui.setCountdown("");
    this.ui.setMatchTimer(""); // ✅ clear HUD timer
    this.ui.hideWinner();
    this.ui.showLobby();
    this.ui.setLobbyCode(this.sessionId);

    this.localReady = false;
    this.ui.setReadyButtonState(false);

    for (const id of this.rosterIds) {
      const p = this.players.get(id);
      if (p) p.ready = false;
    }

    if (this.isHost) this._broadcastRoster();
    this._renderLobbyPlayers();
  }

  // --------------------
  // Network handlers
  // --------------------
  _onGameMessage(fromClientId, data) {
    if (!data || typeof data !== "object") return;

    switch (data.type) {
      case "hello": {
        const p = this.players.get(fromClientId);
        if (p) {
          p.name = String(data.name ?? "Player").slice(0, 24);
          this._renderLobbyPlayers();
          if (this.isHost) this._broadcastRoster();
        } else if (this.isHost) {
          this._addToRosterHost(fromClientId);
          const np = this.players.get(fromClientId);
          if (np) np.name = String(data.name ?? "Player").slice(0, 24);
          this._broadcastRoster();
        }
        break;
      }

      case "ready": {
        const p = this.players.get(fromClientId);
        if (p) p.ready = !!data.ready;
        this._renderLobbyPlayers();
        if (this.isHost) this._tryStartCountdownIfAllReady();
        break;
      }

      case "input": {
        if (!this.isHost) break;
        const rt = this.runtime.get(fromClientId);
        if (!rt) break;
        const dir = data.dir;
        if (!dir || typeof dir.x !== "number" || typeof dir.y !== "number") break;
        if (!isCardinal(dir)) break;
        rt.desiredDir = { x: dir.x, y: dir.y };
        break;
      }

      case "roster": {
        if (this.isHost) break;

        const ids = Array.isArray(data.ids) ? data.ids : [];
        this.rosterIds = ids.slice(0, MAX_PLAYERS);

        const infos = Array.isArray(data.players) ? data.players : [];
        for (const id of this.rosterIds) {
          if (!this.players.has(id)) {
            this.players.set(id, { name: "Player", ready: false, score: 0, isHost: false });
          }
          this._ensureRuntimeFor(id);
        }

        for (const info of infos) {
          if (!info || typeof info !== "object") continue;
          const id = info.id;
          if (!id) continue;
          const p = this.players.get(id);
          if (!p) continue;
          if (typeof info.name === "string") p.name = info.name;
          if (typeof info.ready === "boolean") p.ready = info.ready;
          if (typeof info.score === "number") p.score = info.score;
          if (typeof info.isHost === "boolean") p.isHost = info.isHost;
        }

        this.localReady = !!this.players.get(this.selfId)?.ready;
        this.ui.setReadyButtonState(this.localReady);

        this._renderLobbyPlayers();
        break;
      }

      case "countdown": {
        this.matchState = "countdown";
        this.countdownStartTick = Number(data.startTick ?? 0);
        break;
      }

      case "start": {
        this.matchState = "running";
        this.matchStartTick = Number(data.startTick ?? 0);
        this.matchEndTick = Number(data.endTick ?? 0);
        this.seed = Number(data.seed ?? this.seed) >>> 0;

        this.ui.hideLobby();
        this.ui.setCountdown("");

        // Reset smoothing anchors
        this._snapBuf = [];
        this._lastSnapTick = 0;
        this._lastSnapAt = 0;
        break;
      }

      case "snapshot": {
        const snap = data.snapshot;
        if (!snap || typeof snap !== "object") break;

        const snapTick = Number(snap.tick ?? 0);
        const receivedAt = performance.now();

        this._pushSnapshot({ tick: snapTick, receivedAt, snapshot: snap });

        // Scores
        if (Array.isArray(snap.players)) {
          for (const sp of snap.players) {
            const p = this.players.get(sp.id);
            if (p) p.score = Number(sp.score ?? 0);
          }
        }

        // Winner (supports draw via winnerName)
        if (snap.matchState === "ended" && typeof snap.winnerName === "string") {
          this._showWinnerFromSnapshot(snap);
        }
        break;
      }

      case "winner": {
        this._showWinnerBoard(data);
        break;
      }

      default:
        break;
    }
  }

  _onPeerJoined(clientId) {
    if (!clientId) return;
    if (this.isHost) {
      this._addToRosterHost(clientId);
      this._broadcastRoster();
    }
  }

  _onPeerLeft(clientId) {
    if (!clientId) return;
    const idx = this.rosterIds.indexOf(clientId);
    if (idx !== -1) this.rosterIds.splice(idx, 1);

    this.players.delete(clientId);
    this.runtime.delete(clientId);

    if (this.isHost) this._broadcastRoster();
    this._renderLobbyPlayers();
  }

  _onClosed() {
    this.leave(true);
  }

  // --------------------
  // Host roster helpers
  // --------------------
  _addToRosterHost(clientId) {
    if (this.rosterIds.includes(clientId)) return;
    if (this.rosterIds.length >= MAX_PLAYERS) return;

    this.rosterIds.push(clientId);

    if (!this.players.has(clientId)) {
      this.players.set(clientId, { name: "Player", ready: false, score: 0, isHost: false });
    }
    this._ensureRuntimeFor(clientId);
  }

  _broadcastRoster() {
    if (!this.isHost) return;

    const list = this.rosterIds.map((id) => {
      const p = this.players.get(id);
      return {
        id,
        name: p?.name ?? "Player",
        ready: !!p?.ready,
        score: Number(p?.score ?? 0),
        isHost: !!p?.isHost,
      };
    });

    this.api.transmit({ type: "roster", ids: this.rosterIds.slice(), players: list });
  }

  _renderLobbyPlayers() {
    const arr = this.rosterIds.map((id) => {
      const p = this.players.get(id);
      return {
        name: p?.name ?? "Player",
        ready: !!p?.ready,
        isHost: !!p?.isHost,
      };
    });
    this.ui.setLobbyPlayers(arr);
  }

  _tryStartCountdownIfAllReady() {
    if (!this.isHost) return;
    if (this.matchState !== "lobby") return;
    if (!this.rosterIds.length) return;

    const everyoneReady = this.rosterIds.every((id) => this.players.get(id)?.ready);
    if (!everyoneReady) return;

    this.matchState = "countdown";
    this.countdownStartTick = this.tick;

    this.api.transmit({ type: "countdown", startTick: this.countdownStartTick });
  }

  // --------------------
  // Host runtime + world
  // --------------------
  _ensureRuntimeFor(clientId) {
    if (!clientId) return;
    if (this.runtime.has(clientId)) return;

    const slot = this._slotOf(clientId);
    const spawn = getSlotSpawn(slot, this.cols, this.rows);
    const snake = new Snake(spawn.x, spawn.y, { startDirection: spawn.dir });

    this.runtime.set(clientId, {
      snake,
      lastSegments: snake.segments.map((s) => ({ ...s })),
      desiredDir: { ...spawn.dir },
      speedUntilTick: -1,
      slowUntilTick: -1,
      ghostUntilTick: -1,
      moveAcc: 0,
      alive: true,
      respawnAtTick: null,
    });
  }

  _rebuildWorldHost() {
    this.foods = [];
    this.powerUps = [];

    for (let i = 0; i < FOOD_COUNT; i++) this._spawnFoodHost();
    while (this.powerUps.length < POWERUP_COUNT) this._spawnPowerUpHost();
  }

  _isCellOccupiedHost(x, y) {
    for (const id of this.rosterIds) {
      const rt = this.runtime.get(id);
      if (!rt || !rt.alive) continue;
      if (rt.snake.segments.some((s) => s.x === x && s.y === y)) return true;
    }
    if (this.foods.some((f) => f.x === x && f.y === y)) return true;
    if (this.powerUps.some((p) => p.x === x && p.y === y)) return true;
    return false;
  }

  _spawnFoodHost() {
    for (let tries = 0; tries < 1000; tries++) {
      const x = this.rng.int(0, this.cols - 1);
      const y = this.rng.int(0, this.rows - 1);
      if (this._isCellOccupiedHost(x, y)) continue;
      this.foods.push({ x, y });
      return true;
    }
    return false;
  }

  _spawnPowerUpHost() {
    const types = [PowerUpType.SPEED, PowerUpType.SLOW, PowerUpType.GHOST, PowerUpType.SHRINK];
    for (let tries = 0; tries < 1000; tries++) {
      const x = this.rng.int(0, this.cols - 1);
      const y = this.rng.int(0, this.rows - 1);
      if (this._isCellOccupiedHost(x, y)) continue;
      const type = this.rng.pick(types);
      this.powerUps.push({ type, x, y });
      return true;
    }
    return false;
  }

  // --------------------
  // Loops
  // --------------------
  _startLoops() {
    if (this._rafId) return;
    this._lastRaf = performance.now();
    this._rafId = requestAnimationFrame((t) => this._raf(t));
  }

  _stopLoops() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._lastRaf = null;
    this._tickAcc = 0;
  }

  _raf(now) {
    this._rafId = requestAnimationFrame((t) => this._raf(t));
    const dt = now - (this._lastRaf ?? now);
    this._lastRaf = now;

    this._tickUpdate(dt);
    this._render(now);
  }

  _tickUpdate(dt) {
    this._tickAcc += dt;

    while (this._tickAcc >= TICK_MS) {
      this._tickAcc -= TICK_MS;
      this.tick++;

      if (this.isHost) this._hostTick();
    }
  }

  _hostTick() {
    if (this.matchState === "countdown") {
      const elapsed = this.tick - (this.countdownStartTick ?? this.tick);
      const remaining = Math.max(0, COUNTDOWN_TICKS - elapsed);

      if (remaining <= 0) {
        this.matchState = "running";
        this.matchStartTick = this.tick;
        this.matchEndTick = this.matchStartTick + MATCH_DURATION_TICKS;

        for (const id of this.rosterIds) {
          const p = this.players.get(id);
          if (p) p.score = 0;
        }

        this.seed = (Date.now() ^ this.seed) >>> 0;
        this.rng = new RNG(this.seed);
        this._rebuildWorldHost();

        for (const id of this.rosterIds) this._respawnPlayerHost(id, true);

        this.api.transmit({
          type: "start",
          startTick: this.matchStartTick,
          endTick: this.matchEndTick,
          seed: this.seed,
        });

        this.ui.hideLobby();
        this.ui.setCountdown("");

        this._broadcastRoster();
      }
    }

    if (this.matchState === "running") {
      if (this.tick >= (this.matchEndTick ?? 0)) {
        this.matchState = "ended";
      } else {
        this._simulateHostOneTick();
      }
    }

    if (this.matchState === "ended") {
      // ✅ Deterministic tie-breaker: draw if multiple share top score
      const scores = this.rosterIds.map((id) => ({
        id,
        name: this.players.get(id)?.name ?? "Player",
        score: Number(this.players.get(id)?.score ?? 0),
      }));

      scores.sort((a, b) => b.score - a.score);

      const topScore = scores[0]?.score ?? 0;
      const top = scores.filter((s) => s.score === topScore);
      const winnerName = top.length >= 2 ? "Tie" : (scores[0]?.name ?? "");

      const snap = this._buildSnapshotHost();
      snap.matchState = "ended";
      snap.winnerName = winnerName; // ✅ used by clients
      snap.winners = top.map((t) => ({ name: t.name, score: t.score })); // optional, informative

      this.api.transmit({ type: "snapshot", snapshot: snap });
      this.api.transmit({
        type: "winner",
        winnerName,
        scores: scores.map((s) => ({ name: s.name, score: s.score })),
        winners: top.map((t) => ({ name: t.name, score: t.score })), // optional
      });

      return;
    }

    const snap = this._buildSnapshotHost();
    this.api.transmit({ type: "snapshot", snapshot: snap });
  }

  // ====== Host sim (same as before) ======
  _simulateHostOneTick() {
    // Respawns
    for (const id of this.rosterIds) {
      const rt = this.runtime.get(id);
      if (!rt) continue;
      if (!rt.alive && rt.respawnAtTick != null && this.tick >= rt.respawnAtTick) {
        this._respawnPlayerHost(id);
      }
    }

    // Apply direction
    for (const id of this.rosterIds) {
      const rt = this.runtime.get(id);
      if (!rt || !rt.alive) continue;
      rt.snake.setDirection(rt.desiredDir.x, rt.desiredDir.y);
    }

    // Steps per tick (speed accumulator)
    const stepsToDo = new Map();
    let maxSteps = 0;

    for (const id of this.rosterIds) {
      const rt = this.runtime.get(id);
      if (!rt || !rt.alive) continue;

      rt.lastSegments = rt.snake.segments.map((s) => ({ ...s }));

      const mult = this._getMoveMultiplierHost(id);
      rt.moveAcc += mult;

      let steps = Math.floor(rt.moveAcc);
      rt.moveAcc -= steps;

      if (steps < 0) steps = 0;
      stepsToDo.set(id, steps);
      if (steps > maxSteps) maxSteps = steps;
    }

    for (let sub = 0; sub < maxSteps; sub++) {
      const movers = [];
      for (const [id, steps] of stepsToDo.entries()) {
        if (steps > sub) movers.push(id);
      }
      if (!movers.length) continue;
      this._simulateHostSubstep(movers);
    }
  }

  _simulateHostSubstep(movers) {
    const nextHeads = new Map();

    for (const id of movers) {
      const rt = this.runtime.get(id);
      if (!rt || !rt.alive) continue;

      const head = rt.snake.segments[0];
      const dir = rt.snake.nextDirection ?? rt.snake.direction;
      nextHeads.set(id, { x: head.x + dir.x, y: head.y + dir.y });
    }

    const toDie = new Set();

    // Wall collision
    for (const [id, nh] of nextHeads.entries()) {
      if (nh.x < 0 || nh.x >= this.cols || nh.y < 0 || nh.y >= this.rows) {
        toDie.add(id);
      }
    }

    // Head-on collision
    const cellMap = new Map();
    for (const [id, nh] of nextHeads.entries()) {
      if (toDie.has(id)) continue;
      const key = `${nh.x},${nh.y}`;
      if (!cellMap.has(key)) cellMap.set(key, []);
      cellMap.get(key).push(id);
    }

    for (const ids of cellMap.values()) {
      if (ids.length < 2) continue;

      const anyGhost = ids.some((pid) => this._isGhostHost(pid));
      if (anyGhost) continue;

      const lengths = ids.map((pid) => ({
        id: pid,
        len: this.runtime.get(pid)?.snake.segments.length ?? 0,
      }));
      lengths.sort((a, b) => b.len - a.len);

      if (lengths[0].len === lengths[1].len) {
        for (const pid of ids) toDie.add(pid);
      } else {
        const maxLen = lengths[0].len;
        for (const entry of lengths) if (entry.len < maxLen) toDie.add(entry.id);
      }
    }

    // Body collision
    const occupied = new Set();
    const tailVacates = new Set();

    for (const id of this.rosterIds) {
      const rt = this.runtime.get(id);
      if (!rt || !rt.alive) continue;
      for (const s of rt.snake.segments) occupied.add(`${s.x},${s.y}`);
    }

    for (const id of movers) {
      const rt = this.runtime.get(id);
      if (!rt || !rt.alive) continue;
      const tail = rt.snake.segments[rt.snake.segments.length - 1];
      tailVacates.add(`${tail.x},${tail.y}`);
    }
    for (const key of tailVacates) occupied.delete(key);

    for (const [id, nh] of nextHeads.entries()) {
      if (toDie.has(id)) continue;
      if (this._isGhostHost(id)) continue;
      if (occupied.has(`${nh.x},${nh.y}`)) toDie.add(id);
    }

    for (const id of toDie) this._killPlayerHost(id);

    for (const id of movers) {
      if (toDie.has(id)) continue;
      const rt = this.runtime.get(id);
      if (!rt || !rt.alive) continue;

      rt.snake.step();
      this._handlePickupsHost(id);
    }
  }

  _handlePickupsHost(id) {
    const rt = this.runtime.get(id);
    if (!rt || !rt.alive) return;

    const head = rt.snake.segments[0];

    // Powerups
    const pidx = this.powerUps.findIndex((p) => p.x === head.x && p.y === head.y);
    if (pidx !== -1) {
      const picked = this.powerUps.splice(pidx, 1)[0];

      switch (picked.type) {
        case PowerUpType.SPEED: {
          const dur = Math.ceil(EFFECT.SPEED_MS / TICK_MS);
          rt.speedUntilTick = Math.max(rt.speedUntilTick, this.tick + dur);
          break;
        }
        case PowerUpType.SLOW: {
          const dur = Math.ceil(EFFECT.SLOW_MS / TICK_MS);
          for (const pid of this.rosterIds) {
            if (pid === id) continue;
            const prt = this.runtime.get(pid);
            if (!prt || !prt.alive) continue;
            prt.slowUntilTick = Math.max(prt.slowUntilTick, this.tick + dur);
          }
          break;
        }
        case PowerUpType.GHOST: {
          const dur = Math.ceil(EFFECT.GHOST_MS / TICK_MS);
          rt.ghostUntilTick = Math.max(rt.ghostUntilTick, this.tick + dur);
          break;
        }
        case PowerUpType.SHRINK: {
          rt.snake.shrink(EFFECT.SHRINK_AMOUNT, EFFECT.MIN_SNAKE_LEN);
          break;
        }
      }

      while (this.powerUps.length < POWERUP_COUNT) this._spawnPowerUpHost();
    }

    // Food
    const fidx = this.foods.findIndex((f) => f.x === head.x && f.y === head.y);
    if (fidx !== -1) {
      this.foods.splice(fidx, 1);
      rt.snake.grow();

      const p = this.players.get(id);
      if (p) p.score = Number(p.score ?? 0) + 10;

      while (this.foods.length < FOOD_COUNT) this._spawnFoodHost();
    }
  }

  _killPlayerHost(id) {
    const rt = this.runtime.get(id);
    if (!rt || !rt.alive) return;

    rt.alive = false;
    rt.respawnAtTick = this.tick + RESPAWN_DELAY_TICKS;
    rt.moveAcc = 0;
    rt.snake.segments = [];

    const p = this.players.get(id);
    if (p) p.score = 0;
  }

  _respawnPlayerHost(id, force = false) {
    const rt = this.runtime.get(id);
    if (!rt) return;

    const slot = this._slotOf(id);
    const preferred = getSlotSpawn(slot, this.cols, this.rows);

    const candidates = [{ x: preferred.x, y: preferred.y, dir: preferred.dir }];

    const radius = 6;
    for (let r = 1; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = preferred.x + dx;
          const y = preferred.y + dy;
          if (x < 1 || x >= this.cols - 1 || y < 1 || y >= this.rows - 1) continue;
          candidates.push({ x, y, dir: preferred.dir });
        }
      }
    }

    for (let i = 0; i < 200; i++) {
      candidates.push({
        x: this.rng.int(1, this.cols - 2),
        y: this.rng.int(1, this.rows - 2),
        dir: preferred.dir,
      });
    }

    const canPlace = (x, y) => !this._isCellOccupiedHost(x, y);

    for (const c of candidates) {
      if (!canPlace(c.x, c.y)) continue;

      const sn = new Snake(c.x, c.y, { startDirection: c.dir });
      rt.snake = sn;
      rt.lastSegments = sn.segments.map((s) => ({ ...s }));
      rt.desiredDir = { ...c.dir };

      rt.alive = true;
      rt.respawnAtTick = null;

      rt.speedUntilTick = -1;
      rt.slowUntilTick = -1;
      rt.ghostUntilTick = -1;
      rt.moveAcc = 0;
      return;
    }

    if (force) {
      const sn = new Snake(preferred.x, preferred.y, { startDirection: preferred.dir });
      rt.snake = sn;
      rt.lastSegments = sn.segments.map((s) => ({ ...s }));
      rt.desiredDir = { ...preferred.dir };
      rt.alive = true;
      rt.respawnAtTick = null;
      rt.speedUntilTick = -1;
      rt.slowUntilTick = -1;
      rt.ghostUntilTick = -1;
      rt.moveAcc = 0;
    }
  }

  _getMoveMultiplierHost(id) {
    const rt = this.runtime.get(id);
    if (!rt || !rt.alive) return 0;

    let mult = 1.0;
    if (this.tick < rt.speedUntilTick) mult *= EFFECT.SPEED_MULT;
    if (this.tick < rt.slowUntilTick) mult *= EFFECT.SLOW_MULT;
    if (!Number.isFinite(mult)) mult = 1.0;
    return Math.max(0, Math.min(3.0, mult));
  }

  _isGhostHost(id) {
    const rt = this.runtime.get(id);
    if (!rt || !rt.alive) return false;
    return this.tick < rt.ghostUntilTick;
  }

  _slotOf(clientId) {
    const idx = this.rosterIds.indexOf(clientId);
    return idx === -1 ? 0 : idx;
  }

  _buildSnapshotHost() {
    const players = [];

    for (const id of this.rosterIds) {
      const p = this.players.get(id);
      const rt = this.runtime.get(id);

      const slot = this._slotOf(id);
      const segs = rt?.snake?.segments ?? [];
      const lastSegs = rt?.lastSegments ?? segs;

      players.push({
        id,
        slot,
        name: p?.name ?? "Player",
        ready: !!p?.ready,
        score: Number(p?.score ?? 0),

        alive: !!rt?.alive,
        respawnAtTick: rt?.respawnAtTick ?? null,

        speedUntilTick: rt?.speedUntilTick ?? -1,
        slowUntilTick: rt?.slowUntilTick ?? -1,
        ghostUntilTick: rt?.ghostUntilTick ?? -1,

        segments: segs.map((s) => ({ x: s.x, y: s.y })),
        lastSegments: lastSegs.map((s) => ({ x: s.x, y: s.y })),
      });
    }

    return {
      tick: this.tick,
      tickMs: TICK_MS,
      matchState: this.matchState,
      matchStartTick: this.matchStartTick,
      matchEndTick: this.matchEndTick,
      foods: this.foods.map((f) => ({ ...f })),
      powerUps: this.powerUps.map((p) => ({ ...p })),
      players,
    };
  }

  // --------------------
  // Snapshot buffer helpers
  // --------------------
  _pushSnapshot(entry) {
    this._snapBuf.push(entry);
    this._snapBuf.sort((a, b) => a.tick - b.tick);

    const last = this._snapBuf[this._snapBuf.length - 1];
    if (last) {
      this._lastSnapTick = last.tick;
      this._lastSnapAt = last.receivedAt;
    }

    while (this._snapBuf.length > 20) this._snapBuf.shift();
  }

  _estimateHostTick(now) {
    if (this.isHost) return this.tick;

    const last = this._snapBuf[this._snapBuf.length - 1];
    if (!last) return this.tick;

    const anchorTick = this._lastSnapTick || last.tick;
    const anchorAt = this._lastSnapAt || last.receivedAt;
    const dtMs = Math.max(0, now - anchorAt);
    return anchorTick + dtMs / TICK_MS;
  }

  // ✅ allowExtrap: if targetTick > newestSnapshot.tick, allow t > 1 up to maxExtrapTicks
  _pickSnapshotsForRender(now, delayTicks, allowExtrap, maxExtrapTicks) {
    if (this._snapBuf.length === 0) return null;
    if (this._snapBuf.length === 1) return { a: this._snapBuf[0], b: this._snapBuf[0], t: 1 };

    const last = this._snapBuf[this._snapBuf.length - 1];
    const anchorTick = this._lastSnapTick || last.tick;
    const anchorAt = this._lastSnapAt || last.receivedAt;

    const dtMs = Math.max(0, now - anchorAt);
    const hostTickNowEst = anchorTick + dtMs / TICK_MS;
    let targetTick = hostTickNowEst - delayTicks;

    // Find b = first snapshot with tick >= targetTick
    let bIndex = this._snapBuf.findIndex((s) => s.tick >= targetTick);

    // If we're beyond newest snapshot:
    if (bIndex === -1) {
      if (!allowExtrap) {
        // clamp to newest => causes "freeze then jump"
        bIndex = this._snapBuf.length - 1;
        const a = this._snapBuf[Math.max(0, bIndex - 1)];
        return { a, b: this._snapBuf[bIndex], t: 1 };
      }

      // Extrapolate using the last two snapshots
      const b = this._snapBuf[this._snapBuf.length - 1];
      const a = this._snapBuf[this._snapBuf.length - 2];

      const span = Math.max(1, b.tick - a.tick);

      const extra = Math.min(maxExtrapTicks, Math.max(0, targetTick - b.tick));
      const t = 1 + extra / span;

      return { a, b, t };
    }

    if (bIndex === 0) bIndex = 1;

    const a = this._snapBuf[bIndex - 1];
    const b = this._snapBuf[bIndex];

    const span = Math.max(1, b.tick - a.tick);
    const t = Math.max(0, Math.min(1, (targetTick - a.tick) / span));

    return { a, b, t };
  }

  // --------------------
  // Render
  // --------------------
  _render(now) {
    // Countdown text (lobby)
    if (this.matchState === "countdown" && this.countdownStartTick != null) {
      const hostTickEstimate = this._estimateHostTick(now);
      const elapsed = hostTickEstimate - this.countdownStartTick;
      const remainingTicks = Math.max(0, COUNTDOWN_TICKS - elapsed);
      const remainingSec = Math.ceil((remainingTicks * TICK_MS) / 1000);
      this.ui.setCountdown(remainingSec > 0 ? String(remainingSec) : "GO!");
      if (remainingTicks === 0) this.ui.setCountdown("");
      this.ui.setMatchTimer(""); // ✅ no match timer during countdown
    } else if (this.matchState === "running") {
      // ✅ Match timer HUD (mm:ss)
      if (this.matchEndTick != null) {
        const hostTickEstimate = this._estimateHostTick(now);
        const ticksLeft = Math.max(0, (this.matchEndTick ?? 0) - hostTickEstimate);
        const msLeft = ticksLeft * TICK_MS;
        this.ui.setMatchTimer(formatMMSS(msLeft));
      } else {
        this.ui.setMatchTimer("");
      }
      this.ui.setCountdown("");
    } else {
      this.ui.setCountdown("");
      this.ui.setMatchTimer("");
    }

    if (this.isHost) {
      const snap = this._buildSnapshotHost();
      const progress = Math.max(0, Math.min(1, this._tickAcc / TICK_MS));
      const state = this._snapshotToRenderStateHost(snap, progress);
      this.game.renderer.render(state);
      return;
    }

    // CLIENT:
    const pickedOthers = this._pickSnapshotsForRender(
      now,
      this._othersDelayTicks,
      false,
      0
    );

    const pickedSelf = this._pickSnapshotsForRender(
      now,
      this._selfDelayTicks,
      true,
      SELF_MAX_EXTRAP_TICKS
    );

    if (!pickedOthers || !pickedSelf) return;

    const foods = pickedOthers.b.snapshot.foods ?? [];
    const powerUps = pickedOthers.b.snapshot.powerUps ?? [];

    const snakes = [];

    // --- Self ---
    {
      const prevSnap = pickedSelf.a.snapshot;
      const nextSnap = pickedSelf.b.snapshot;
      const t = pickedSelf.t;

      const prevPlayers = new Map((prevSnap.players ?? []).map((p) => [p.id, p]));
      const sp = (nextSnap.players ?? []).find((p) => p.id === this.selfId);

      if (sp) {
        const slot = Number(sp.slot ?? 0);
        const colors = SLOT_COLORS[slot] ?? SLOT_COLORS[0];

        const prev = prevPlayers.get(sp.id);
        const prevSegs = prev?.segments ?? sp.segments ?? [];
        const nextSegs = sp.segments ?? [];

        const segsToDraw = interpolateSegments(prevSegs, nextSegs, t);

        snakes.push({
          segments: segsToDraw,
          mpColorBody: colors.body,
          mpColorGlow: colors.glow,
          colorHead: "#d783ff",
          colorHeadStroke: "#b300ff",
          colorBody: colors.body,
          tailScale: 0.6,
        });
      }
    }

    // --- Others ---
    {
      const prevSnap = pickedOthers.a.snapshot;
      const nextSnap = pickedOthers.b.snapshot;
      const t = pickedOthers.t;

      const prevPlayers = new Map((prevSnap.players ?? []).map((p) => [p.id, p]));
      for (const sp of nextSnap.players ?? []) {
        if (sp.id === this.selfId) continue;

        const slot = Number(sp.slot ?? 0);
        const colors = SLOT_COLORS[slot] ?? SLOT_COLORS[0];

        const prev = prevPlayers.get(sp.id);
        const prevSegs = prev?.segments ?? sp.segments ?? [];
        const nextSegs = sp.segments ?? [];

        const segsToDraw = interpolateSegments(prevSegs, nextSegs, t);

        snakes.push({
          segments: segsToDraw,
          mpColorBody: colors.body,
          mpColorGlow: colors.glow,
          colorHead: "#d783ff",
          colorHeadStroke: "#b300ff",
          colorBody: colors.body,
          tailScale: 0.6,
        });
      }
    }

    this.game.renderer.render({ foods, powerUps, activeEffects: [], snakes });
  }

  _snapshotToRenderStateHost(snap, progress) {
    const foods = snap.foods ?? [];
    const powerUps = snap.powerUps ?? [];
    const snakes = [];

    for (const sp of snap.players ?? []) {
      const slot = Number(sp.slot ?? 0);
      const colors = SLOT_COLORS[slot] ?? SLOT_COLORS[0];

      const prevSegs = sp.lastSegments ?? sp.segments ?? [];
      const nextSegs = sp.segments ?? [];
      const segsToDraw = interpolateSegments(prevSegs, nextSegs, progress);

      snakes.push({
        segments: segsToDraw,
        mpColorBody: colors.body,
        mpColorGlow: colors.glow,
        colorHead: "#d783ff",
        colorHeadStroke: "#b300ff",
        colorBody: colors.body,
        tailScale: 0.6,
      });
    }

    return { foods, powerUps, activeEffects: [], snakes };
  }

  _showWinnerFromSnapshot(snap) {
    const scores = (snap.players ?? []).map((p) => ({
      name: p.name ?? "Player",
      score: Number(p.score ?? 0),
    }));
    const winnerName = typeof snap.winnerName === "string" ? snap.winnerName : "";
    this.ui.showWinnerBoard({ winnerName, scores });
  }

  _showWinnerBoard(data) {
    const winnerName = data?.winnerName ?? "";
    const scores = Array.isArray(data?.scores) ? data.scores : [];
    this.ui.showWinnerBoard({ winnerName, scores });
  }

  _resetAllState() {
    this.isActive = false;
    this.isHost = false;
    this.sessionId = null;
    this.selfId = null;
    this.selfName = "Player";
    this.localReady = false;

    this.matchState = "idle";
    this.tick = 0;
    this.countdownStartTick = null;
    this.matchStartTick = null;
    this.matchEndTick = null;

    this.rosterIds = [];
    this.players.clear();
    this.runtime.clear();

    this.foods = [];
    this.powerUps = [];

    this._snapBuf = [];
    this._lastSnapTick = 0;
    this._lastSnapAt = 0;

    this.seed = (Date.now() ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
    this.rng = new RNG(this.seed);

    this._tickAcc = 0;
  }
}

// --------------------
// Utils
// --------------------
function keyToDir(key) {
  switch (key) {
    case "ArrowUp":
    case "w":
    case "W":
      return { x: 0, y: -1 };

    case "ArrowDown":
    case "s":
    case "S":
      return { x: 0, y: 1 };

    case "ArrowLeft":
    case "a":
    case "A":
      return { x: -1, y: 0 };

    case "ArrowRight":
    case "d":
    case "D":
      return { x: 1, y: 0 };

    default:
      return null;
  }
}

function isCardinal(dir) {
  return (
    (dir.x === 1 && dir.y === 0) ||
    (dir.x === -1 && dir.y === 0) ||
    (dir.x === 0 && dir.y === 1) ||
    (dir.x === 0 && dir.y === -1)
  );
}

function dedupe(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

// NOTE: We allow t > 1 for self extrapolation (on purpose).
function interpolateSegments(prevSegs, nextSegs, t) {
  const maxLen = Math.max(prevSegs.length, nextSegs.length);
  const out = [];

  for (let i = 0; i < maxLen; i++) {
    const a =
      prevSegs[i] ??
      prevSegs[prevSegs.length - 1] ??
      nextSegs[i] ??
      { x: 0, y: 0 };

    const b =
      nextSegs[i] ??
      nextSegs[nextSegs.length - 1] ??
      prevSegs[i] ??
      { x: 0, y: 0 };

    out.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
  }

  return out;
}

// ✅ mm:ss formatter (ms can be float)
function formatMMSS(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
