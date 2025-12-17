import { mpapi } from "./mpapi.js";
import { MultiplayerGame } from "./MultiplayerGame.js";

export class MultiplayerController {
  constructor({ canvas, scoreElement, ui, serverUrl, identifier }) {
    this.canvas = canvas;
    this.scoreElement = scoreElement;
    this.ui = ui;

    this.serverUrl = serverUrl;
    this.identifier = identifier;

    this.api = null;

    this.isHost = false;
    this.sessionId = null;
    this.clientId = null;

    this.players = new Map(); // clientId -> {name, ready, slot}
    this.localReady = false;
    this.localName = "Player";

    this.game = null;

    if (this.ui) {
      this.ui.onMpHostRequest = (name) => this.hostLobby(name);
      this.ui.onMpJoinRequest = (code, name) => this.joinLobby(code, name);
      this.ui.onMpReadyToggle = () => this.toggleReady();
      this.ui.onMpLeave = () => this.leaveLobby();
    }
  }

  isInMultiplayerGame() {
    return !!this.game?.isRunning;
  }

  ensureApi() {
    if (this.api) return;

    this.api = new mpapi(this.serverUrl, this.identifier);

    this.api.listen((cmd, messageId, clientId, data) => {
      if (cmd === "joined") this.onJoined(clientId);
      else if (cmd === "left") this.onLeft(clientId);
      else if (cmd === "closed") this.onClosed();
      else if (cmd === "game") this.onGameMessage(clientId, data);
    });
  }

  rebuildLobbyUi() {
    if (!this.ui) return;

    const list = Array.from(this.players.entries())
      .map(([cid, p]) => ({
        name: p.name,
        ready: !!p.ready,
        isHost: this.isHost ? cid === this.clientId : cid === this.hostId,
      }))
      .sort((a, b) => (a.isHost === b.isHost ? 0 : a.isHost ? -1 : 1));

    this.ui.setLobbyPlayers(list);
    this.ui.setReadyButtonState(this.localReady);
  }

  async hostLobby(name) {
    this.ensureApi();

    this.isHost = true;
    this.localReady = false;
    this.localName = (name || "Player").trim() || "Player";

    const res = await this.api.host({ name: this.localName, private: true }).catch((e) => {
      console.error("Host failed:", e);
      return null;
    });
    if (!res) return;

    this.sessionId = res.session;
    this.clientId = res.clientId;

    this.players.clear();
    this.players.set(this.clientId, { name: this.localName, ready: false, slot: 1 });

    this.ui?.showLobby();
    this.ui?.setLobbyCode(this.sessionId);
    this.ui?.setCountdown("");

    this.rebuildLobbyUi();
    this.broadcastLobbyState();
  }

  async joinLobby(code, name) {
    this.ensureApi();

    this.isHost = false;
    this.localReady = false;
    this.localName = (name || "Player").trim() || "Player";

    const res = await this.api.join(code, { name: this.localName }).catch((e) => {
      console.error("Join failed:", e);
      return null;
    });
    if (!res) return;

    this.sessionId = res.session;
    this.clientId = res.clientId;

    this.players.clear();
    for (const cid of res.clients ?? []) {
      this.players.set(cid, { name: `Player-${String(cid).slice(-4)}`, ready: false, slot: 0 });
    }
    if (!this.players.has(this.clientId)) {
      this.players.set(this.clientId, { name: this.localName, ready: false, slot: 0 });
    } else {
      this.players.get(this.clientId).name = this.localName;
    }

    this.ui?.showLobby();
    this.ui?.setLobbyCode(this.sessionId);
    this.ui?.setCountdown("");

    this.api.transmit({ type: "lobby_sync_request" });
    this.rebuildLobbyUi();
  }

  toggleReady() {
    if (!this.api || !this.sessionId) return;

    this.localReady = !this.localReady;

    const me = this.players.get(this.clientId);
    if (me) {
      me.ready = this.localReady;
      me.name = this.localName;
    }

    this.api.transmit({ type: "ready", ready: this.localReady, name: this.localName });

    this.rebuildLobbyUi();
    if (this.isHost) this.maybeStartCountdown();
  }

  leaveLobby() {
    this.game?.stop();
    this.game = null;

    this.api?.leave();

    this.isHost = false;
    this.sessionId = null;
    this.clientId = null;
    this.players.clear();
    this.localReady = false;

    this.ui?.hideLobby();
    this.ui?.setCountdown("");
    this.ui?.setLobbyCode("");
  }

  onJoined(clientId) {
    if (!clientId) return;

    if (!this.players.has(clientId)) {
      this.players.set(clientId, { name: `Player-${String(clientId).slice(-4)}`, ready: false, slot: 0 });
    }

    if (this.isHost) {
      this.assignSlotsHostSide();
      this.broadcastLobbyState();
      this.maybeStartCountdown();
    }

    this.rebuildLobbyUi();
  }

  onLeft(clientId) {
    if (!clientId) return;
    this.players.delete(clientId);

    if (this.isHost) {
      this.assignSlotsHostSide();
      this.broadcastLobbyState();
    }

    this.rebuildLobbyUi();
  }

  onClosed() {
    this.leaveLobby();
  }

  onGameMessage(fromClientId, data) {
    if (!data || typeof data !== "object") return;

    switch (data.type) {
      case "lobby_state":
        if (this.isHost) return;
        this.applyLobbyState(data);
        break;

      case "lobby_sync_request":
        if (!this.isHost) return;
        this.broadcastLobbyState();
        break;

      case "ready":
        if (!this.isHost) return;
        const p = this.players.get(fromClientId);
        if (p) {
          p.ready = !!data.ready;
          if (typeof data.name === "string" && data.name.trim()) p.name = data.name.trim();
        }
        this.rebuildLobbyUi();
        this.broadcastLobbyState();
        this.maybeStartCountdown();
        break;

      case "countdown":
        if (this.isHost) return;
        this.ui?.setCountdown(`Starting in ${data.seconds}…`);
        break;

      case "start_game":
        this.startMultiplayerGameClient(data);
        break;

      case "input":
        if (!this.isHost) return;
        this.game?.applyRemoteInput(fromClientId, data.key);
        break;

      case "state":
        if (this.isHost) return;
        this.game?.applyRemoteState(data.state);
        break;

      case "end":
        this.handleGameEnd(data);
        break;
    }
  }

  assignSlotsHostSide() {
    const ids = Array.from(this.players.keys()).sort();
    for (let i = 0; i < ids.length; i++) {
      const p = this.players.get(ids[i]);
      if (p) p.slot = i + 1;
    }
  }

  broadcastLobbyState() {
    if (!this.isHost || !this.api) return;

    this.assignSlotsHostSide();

    this.api.transmit({
      type: "lobby_state",
      players: Array.from(this.players.entries()).map(([cid, p]) => ({
        clientId: cid,
        name: p.name,
        ready: !!p.ready,
        slot: p.slot,
      })),
      sessionId: this.sessionId,
    });
  }

  applyLobbyState(data) {
    const players = Array.isArray(data.players) ? data.players : [];
    this.players.clear();

    for (const p of players) {
      if (!p?.clientId) continue;
      this.players.set(p.clientId, {
        name: p.name ?? `Player-${String(p.clientId).slice(-4)}`,
        ready: !!p.ready,
        slot: p.slot ?? 0,
      });
    }

    this.rebuildLobbyUi();
  }

  maybeStartCountdown() {
    if (!this.isHost || !this.api) return;

    const list = Array.from(this.players.values());
    if (list.length < 2) return;
    if (!list.every((p) => p.ready)) return;
    if (this.game?.isRunning) return;

    let seconds = 5;
    this.ui?.setCountdown(`Starting in ${seconds}…`);
    this.api.transmit({ type: "countdown", seconds });

    const timer = setInterval(() => {
      seconds -= 1;
      if (seconds > 0) {
        this.ui?.setCountdown(`Starting in ${seconds}…`);
        this.api.transmit({ type: "countdown", seconds });
        return;
      }
      clearInterval(timer);
      this.startMultiplayerGameHost();
    }, 1000);
  }

  startMultiplayerGameHost() {
    if (!this.isHost || !this.api) return;

    this.assignSlotsHostSide();
    this.broadcastLobbyState();

    this.game = new MultiplayerGame({
      mode: "host",
      canvas: this.canvas,
      scoreElement: this.scoreElement,
      players: this.players,
      hostClientId: this.clientId,
      onBroadcastState: (state) => this.api.transmit({ type: "state", state }),
      onEnd: (payload) => {
        this.api.transmit({ type: "end", ...payload });
        this.handleGameEnd({ type: "end", ...payload });
      },
    });

    this.api.transmit({
      type: "start_game",
      sessionId: this.sessionId,
      hostClientId: this.clientId,
      players: Array.from(this.players.entries()).map(([cid, p]) => ({
        clientId: cid,
        name: p.name,
        slot: p.slot,
      })),
    });

    this.ui?.hideLobby();
    this.ui?.setCountdown("");

    this.game.start();
  }

  startMultiplayerGameClient(data) {
    const players = Array.isArray(data.players) ? data.players : [];
    this.players.clear();
    for (const p of players) {
      if (!p?.clientId) continue;
      this.players.set(p.clientId, {
        name: p.name ?? `Player-${String(p.clientId).slice(-4)}`,
        ready: false,
        slot: p.slot ?? 0,
      });
    }

    this.game = new MultiplayerGame({
      mode: "client",
      canvas: this.canvas,
      scoreElement: this.scoreElement,
      players: this.players,
      hostClientId: data.hostClientId,
      onBroadcastState: null,
      onEnd: (payload) => this.handleGameEnd({ type: "end", ...payload }),
    });

    this.ui?.hideLobby();
    this.ui?.setCountdown("");
    this.game.start();
  }

  handleKeyDown(key) {
    if (!this.api || !this.sessionId) return;
    this.api.transmit({ type: "input", key });
  }

  handleGameEnd(data) {
    this.game?.stop();
    this.game = null;

    this.ui?.showWinnerBoard({
      winnerName: data.winnerName,
      scores: data.scores ?? [],
    });

    for (const p of this.players.values()) p.ready = false;
    this.localReady = false;
    this.rebuildLobbyUi();
  }
}
