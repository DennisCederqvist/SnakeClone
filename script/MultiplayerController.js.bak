import { mpapi } from "./mpapi.js";
import { MultiplayerGame } from "./MultiplayerGame.js";

export class MultiplayerController {
  constructor({ canvas, scoreElement, ui, serverUrl, identifier, singleGame }) {
    this.canvas = canvas;
    this.scoreElement = scoreElement;
    this.ui = ui;

    this.serverUrl = serverUrl;
    this.identifier = identifier;

    this.singleGame = singleGame;

    this.api = null;

    this.sessionId = null;
    this.clientId = null;
    this.isHost = false;

    this.players = new Map(); // clientId -> { name, ready, slot }
    this.localReady = false;
    this.localName = "Player";

    this.game = null;

    if (this.ui) {
      this.ui.onMpHostRequest = (name) => this.hostLobby(name);
      this.ui.onMpJoinRequest = (code, name) => this.joinLobby(code, name);
      this.ui.onMpReadyToggle = () => this.toggleReady();
      this.ui.onMpLeave = () => this.leaveLobby();
    }

    console.log("[MP] controller ready");
  }

  isInMultiplayerSession() {
    return !!this.api && typeof this.sessionId === "string" && this.sessionId.length > 0;
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

    console.log("[MP] api created");
  }

  async hostLobby(name) {
    this.ensureApi();

    this.isHost = true;
    this.localReady = false;
    this.localName = (name || "Player").trim() || "Player";

    console.log("[MP] hosting as", this.localName);

    let res;
    try {
      res = await this.api.host({ name: this.localName, private: true });
    } catch (e) {
      console.error("[MP] host failed", e);
      return;
    }

    if (!res?.session || !res?.clientId) {
      console.error("[MP] host response invalid", res);
      return;
    }

    this.sessionId = res.session;
    this.clientId = res.clientId;

    this.players.clear();
    this.players.set(this.clientId, { name: this.localName, ready: false, slot: 1 });

    this.ui?.showLobby();
    this.ui?.setLobbyCode(this.sessionId);
    this.ui?.setCountdown("");
    this.ui?.setReadyButtonState(false);

    this.rebuildLobbyUi();

    this.assignSlotsHostSide();
    this.broadcastLobbyState();

    console.log("[MP] host ok, session:", this.sessionId);
  }

  async joinLobby(code, name) {
    const session = (code || "").trim();
    if (!session) return;

    this.ensureApi();

    this.isHost = false;
    this.localReady = false;
    this.localName = (name || "Player").trim() || "Player";

    console.log("[MP] joining", session, "as", this.localName);

    let res;
    try {
      res = await this.api.join(session, { name: this.localName });
    } catch (e) {
      console.error("[MP] join failed", e);
      return;
    }

    if (!res?.session || !res?.clientId) {
      console.error("[MP] join response invalid", res);
      return;
    }

    this.sessionId = res.session;
    this.clientId = res.clientId;

    this.players.clear();
    for (const cid of res.clients ?? []) {
      this.players.set(cid, { name: `Player-${String(cid).slice(-4)}`, ready: false, slot: 0 });
    }
    this.players.set(this.clientId, { name: this.localName, ready: false, slot: 0 });

    this.ui?.showLobby();
    this.ui?.setLobbyCode(this.sessionId);
    this.ui?.setCountdown("");
    this.ui?.setReadyButtonState(false);
    this.rebuildLobbyUi();

    // Be host om state
    this.api.transmit({ type: "lobby_sync_request" });

    console.log("[MP] join ok, session:", this.sessionId);
  }

  toggleReady() {
    if (!this.isInMultiplayerSession()) return;

    this.localReady = !this.localReady;

    const me = this.players.get(this.clientId);
    if (me) {
      me.ready = this.localReady;
      me.name = this.localName;
    }

    this.ui?.setReadyButtonState(this.localReady);
    this.rebuildLobbyUi();

    this.api.transmit({ type: "ready", ready: this.localReady, name: this.localName });

    if (this.isHost) this.maybeStartCountdown();
  }

  leaveLobby() {
    if (this.api) this.api.leave();

    this.stopMultiplayerMatch();

    this.api = null;
    this.sessionId = null;
    this.clientId = null;
    this.isHost = false;
    this.players.clear();
    this.localReady = false;

    this.ui?.setLobbyCode("");
    this.ui?.setCountdown("");
    this.ui?.hideLobby();

    console.log("[MP] left lobby");
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
    console.log("[MP] session closed by server");
    this.leaveLobby();
  }

  onGameMessage(fromClientId, data) {
    if (!data || typeof data !== "object") return;

    switch (data.type) {
      case "lobby_sync_request":
        if (!this.isHost) return;
        this.broadcastLobbyState();
        break;

      case "lobby_state":
        if (this.isHost) return;
        this.applyLobbyState(data);
        break;

      case "ready":
        if (!this.isHost) return;
        {
          const p = this.players.get(fromClientId);
          if (p) {
            p.ready = !!data.ready;
            if (typeof data.name === "string" && data.name.trim()) p.name = data.name.trim();
          }
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
        // === CRITICAL FIX ===
        // Host får ofta tillbaka sin egen broadcast. Ignorera så host inte startar som client på sig själv.
        if (this.isHost) return;
        this.startMultiplayerMatchClient(data);
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
        this.handleMatchEnd(data);
        break;
    }
  }

  rebuildLobbyUi() {
    if (!this.ui) return;

    const list = Array.from(this.players.entries()).map(([cid, p]) => ({
      name: p.name,
      ready: !!p.ready,
      isHost: this.isHost ? cid === this.clientId : false,
    }));

    this.ui.setLobbyPlayers(list);
  }

  assignSlotsHostSide() {
    const ids = Array.from(this.players.keys()).sort();
    for (let i = 0; i < ids.length; i++) {
      const p = this.players.get(ids[i]);
      if (p) p.slot = i + 1;
    }
  }

  broadcastLobbyState() {
    if (!this.isHost || !this.isInMultiplayerSession()) return;

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

    const me = this.players.get(this.clientId);
    if (me) me.name = this.localName;

    this.rebuildLobbyUi();
  }

  maybeStartCountdown() {
    if (!this.isHost || !this.isInMultiplayerSession()) return;
    if (this.game?.isRunning) return;

    const list = Array.from(this.players.values());
    if (list.length < 2) return;
    if (!list.every((p) => p.ready)) return;

    let seconds = 5;
    this.ui?.setCountdown(`Starting in ${seconds}…`);
    this.api.transmit({ type: "countdown", seconds });

    const t = setInterval(() => {
      seconds -= 1;
      if (seconds > 0) {
        this.ui?.setCountdown(`Starting in ${seconds}…`);
        this.api.transmit({ type: "countdown", seconds });
        return;
      }
      clearInterval(t);
      this.startMultiplayerMatchHost();
    }, 1000);
  }

  startMultiplayerMatchHost() {
    if (!this.isHost || !this.isInMultiplayerSession()) return;

    this.singleGame.isRunning = false;
    this.singleGame.setRenderEnabled(false);

    const payloadPlayers = Array.from(this.players.entries()).map(([cid, p]) => ({
      clientId: cid,
      name: p.name,
      slot: p.slot,
    }));

    this.game = new MultiplayerGame({
      mode: "host",
      canvas: this.canvas,
      scoreElement: this.scoreElement,
      players: this.players,
      hostClientId: this.clientId,
      onBroadcastState: (state) => this.api.transmit({ type: "state", state }),
      onEnd: (result) => {
        this.api.transmit({ type: "end", ...result });
        this.handleMatchEnd({ type: "end", ...result });
      },
    });

    this.api.transmit({
      type: "start_game",
      sessionId: this.sessionId,
      hostClientId: this.clientId,
      players: payloadPlayers,
    });

    this.ui?.hideLobby();
    this.ui?.setCountdown("");

    this.game.start();
  }

  startMultiplayerMatchClient(data) {
    this.singleGame.isRunning = false;
    this.singleGame.setRenderEnabled(false);

    this.players.clear();
    for (const p of data.players ?? []) {
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
      onEnd: (result) => this.handleMatchEnd({ type: "end", ...result }),
    });

    this.ui?.hideLobby();
    this.ui?.setCountdown("");

    this.game.start();
  }

  stopMultiplayerMatch() {
    this.game?.stop();
    this.game = null;

    this.singleGame.setRenderEnabled(true);
  }

  handleMatchEnd(data) {
    this.stopMultiplayerMatch();

    this.ui?.showWinnerBoard({
      winnerName: data.winnerName,
      scores: data.scores ?? [],
    });

    for (const p of this.players.values()) p.ready = false;
    this.localReady = false;
    this.ui?.setReadyButtonState(false);
    this.rebuildLobbyUi();
  }

  // === CRITICAL FIX 2: host input lokalt, clients via server ===
  handleKeyDown(key) {
    if (!this.isInMultiplayerSession()) return;

    // Om host och matchen kör: applicera direkt (minskar lagg/jitter)
    if (this.isHost && this.game?.isRunning) {
      this.game.applyRemoteInput(this.clientId, key);
      return;
    }

    // Clients: skicka till host via server
    this.api.transmit({ type: "input", key });
  }
}
