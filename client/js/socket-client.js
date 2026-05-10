import { io } from 'socket.io-client';

// `||` (not `??`) so an empty string falls through to the dev default — Cloudflare
// Pages and similar hosts can ship an empty VITE_SERVER_URL when the env var isn't
// set on the right environment, and Socket.IO interprets that as "same origin".
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
if (!import.meta.env.VITE_SERVER_URL && import.meta.env.PROD) {
  console.warn('VITE_SERVER_URL is not set — falling back to http://localhost:3000. Set it in your host\'s prod env vars and rebuild.');
}

class SocketClient {
  constructor() {
    this.socket = null;
    this.handlers = new Map();
  }

  connect() {
    if (this.socket && this.socket.connected) return;
    this.socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });

    // Re-attach previously registered handlers (after manual disconnect/reconnect cycles).
    for (const [event, fns] of this.handlers) {
      for (const fn of fns) this.socket.on(event, fn);
    }
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
    if (this.socket) this.socket.on(event, handler);
  }

  off(event, handler) {
    this.handlers.get(event)?.delete(handler);
    if (this.socket) this.socket.off(event, handler);
  }

  emit(event, payload) {
    if (!this.socket) throw new Error('not connected');
    this.socket.emit(event, payload);
  }

  joinQueue(playerName) {
    this.emit('joinQueue', { playerName });
  }

  sendMove(gameId, from, to, promotion) {
    this.emit('move', { gameId, from, to, ...(promotion ? { promotion } : {}) });
  }

  resign(gameId) { this.emit('resign', { gameId }); }
  offerDraw(gameId) { this.emit('offerDraw', { gameId }); }
  acceptDraw(gameId) { this.emit('acceptDraw', { gameId }); }
  declineDraw(gameId) { this.emit('declineDraw', { gameId }); }
}

export const socketClient = new SocketClient();
