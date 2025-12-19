const WINDOW_MS = 4000;
const TICK_MS = 1000;

export class mpapi {



	constructor(serverUrl, identifier) {
		this.serverUrl = serverUrl;
		this.identifier = identifier;
		this.socket = null;
		this.sessionId = null;
		this.listeners = new Set();
		this.queue = [];

		this.onHost = null;
		this.onJoin = null;

		this.stats = {
			tx: new this.statsC("TX"),
			rx: new this.statsC("RX")
		}

		this._connect();
	}

	_connect() {
		if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
			return;
		}

		this.socket = new WebSocket(this.serverUrl);

		console.log('Connecting to mpapi server at', this.serverUrl);

		this.socket.addEventListener('open', () => {
			console.log('WebSocket connection established');

			const pending = this.queue.slice();
			this.queue.length = 0;
			for (let i = 0; i < pending.length; i += 1) {
				this.socket.send(pending[i]);
			}

				this.socket.addEventListener("close", (event) => {
				console.log("WS close:", event.code, event.reason || "(no reason)");
			});
		});

		console.log('Setting up WebSocket event listeners');


		this.socket.addEventListener('message', (event) => {
			this.stats.rx.tick(1, event.data.byteLength ? event.data.byteLength : event.data.length);

			let payload;
			try {
				payload = JSON.parse(event.data);
			} catch (e) {
				return;
			}

			if (!payload || typeof payload !== 'object') {
				return;
			}

			if (!payload.cmd || typeof payload.cmd !== 'string') {
				return;
			}

			//console.log('Received payload:', payload);


			const cmd = payload.cmd;
			const messageId = typeof payload.messageId === 'number' ? payload.messageId : null;
			const clientId = typeof payload.clientId === 'string' ? payload.clientId : null;
			const data = (payload.data && typeof payload.data === 'object') ? payload.data : {};

			if (cmd === 'host') {
				const session = typeof payload.session === 'string' ? payload.session : null;
				this.sessionId = session;

				if (this.onHost)
					this.onHost(session, clientId, data);

			} else if (cmd === 'join') {
				/*
					session: sessionId,
					name: session.name,
					host: session.host.clientId,
					clients: session.clients.map(c => c.clientId),
					cmd: "join",
					clientId: client.clientId,
					data
				*/

				delete payload.cmd;

				this.sessionId = payload.session;

				if (this.onJoin)
					this.onJoin(payload);

			} else if (cmd === 'list') {
				if (this.onList)
					this.onList(data);

			} else if (cmd === 'joined' || cmd === 'left' || cmd === 'closed' || cmd === 'game') {
				//console.log(`Received ${cmd} command`);

				this.listeners.forEach((listener) => {
					try {
						listener(cmd, messageId, clientId, data);
					} catch (e) {
						console.error('Error in listener callback:', e);
					}
				});
			}

		});

		this.socket.addEventListener('close', () => {
			this.socket = null;
		});

		this.socket.addEventListener('error', (e) => {
			console.error('WebSocket error occurred', e);
			// Ingen ytterligare hantering här; spelkoden kan själv reagera på uteblivna meddelanden.
		});
	}

	_enqueueOrSend(serializedMessage) {
		this.stats.tx.tick(1, serializedMessage.byteLength ? serializedMessage.length : 0);

		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(serializedMessage);
		} else {
			this.queue.push(serializedMessage);
			this._connect();
		}
	}

	_buildPayload(cmd, data, destination = null) {
		const payload = {
			identifier: this.identifier,
			session: this.sessionId,
			destination: destination,
			cmd,
			data: (data && typeof data === 'object') ? data : {}
		};
		return JSON.stringify(payload);
	}

	/*
		data: {
			name: "OPTIONAL NAME",
			private: true|false
		}
	*/
	host(data = {}) {
		return new Promise((resolve, reject) => {
			if (this.sessionId)
				return reject("error_already_hosting_or_joined");

			const serialized = this._buildPayload('host', data);
			this._enqueueOrSend(serialized);

			this.onHost = (session, clientId, data) => {
				this.onHost = null;
				return resolve({ session, clientId, data });
			};
		});
	}

	join(sessionId, data = {}) {
		return new Promise((resolve, reject) => {
			if (this.sessionId)
				return reject("error_already_hosting_or_joined");

			if (typeof sessionId !== 'string')
				return reject("error_invalid_session_id");

			/*
				session: sessionId,
				name: session.name,
				host: session.host.clientId,
				clients: session.clients.map(c => c.clientId),
				cmd: "join",
				clientId: client.clientId,
				data
			*/

			this.onJoin = (data) => {
				this.onJoin = null;
				return resolve(data);
			};

			this.sessionId = sessionId;
			const serialized = this._buildPayload('join', data);
			this._enqueueOrSend(serialized);
		});
	}

	leave() {
		const serialized = this._buildPayload('leave', {});
		this._enqueueOrSend(serialized);
		this.sessionId = null;
	}

	// type can be 'sessions' or 'clients'
	list(type = "sessions") {
		return new Promise((resolve, reject) => {
			this.onList = (data) => {
				this.onList = null;
				return resolve(data);
			};

			const serialized = this._buildPayload('list', { type });
			this._enqueueOrSend(serialized);
		});
	}

	transmit(data, destination = null) {
		const serialized = this._buildPayload('game', data, destination);
		this._enqueueOrSend(serialized);
	}

	listen(callback) {
		if (typeof callback !== 'function') {
			return () => { };
		}
		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	}


	statsC = class {

		constructor(_Type) {
			this.type = _Type;

			this._events = [];
			this._packetSum = 0;
			this._byteSum = 0;
			this._next = 0;

			this.avgPacketsPerSec = 0;
			this.avgBytesPerSec = 0;

			this._startRateTimer();
		}

		_startRateTimer() {
			this._rateTimer = setInterval(() => {
				const now = performance.now();
				const cutoff = now - WINDOW_MS;

				// evict old events
				while (this._events.length && this._events[0].t < cutoff) {
					const e = this._events.shift();
					this._packetSum -= e.packets;
					this._byteSum -= e.bytes;
				}

				// update rates
				const seconds = WINDOW_MS / 1000;
				this.avgPacketsPerSec = this._packetSum / seconds;
				this.avgBytesPerSec = this._byteSum / seconds;

				//console.log(this.type + ` ${this.avgPacketsPerSec.toFixed(2)}pkts/sec ${this.avgBytesPerSec.toFixed(2)}bytes/sec`);
			}, TICK_MS);
		}

		tick(_Packets, _Bytes) {
			const now = performance.now();

			// record event only
			this._events.push({ t: now, packets: _Packets, bytes: _Bytes });
			this._packetSum += _Packets;
			this._byteSum += _Bytes;
		}
	}
}