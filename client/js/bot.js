import { Chess } from 'chess.js';
import { selectBotMove } from './bot-engine.js';

// ---------------------------------------------------------------------------
// LocalGame: emulates the server's event protocol for a single human-vs-bot
// game. Same method names as socketClient (sendMove/resign/offerDraw/etc.)
// so main.js can treat it as a drop-in replacement.
//
// The expensive move search runs in a Web Worker so Pixi animations and DOM
// updates don't freeze while the bot thinks. A 'botThinking' event is emitted
// to the host so it can show "Thinking…" in the UI.
// ---------------------------------------------------------------------------

export class LocalGame {
  constructor({ playerName, playerColor = 'white', botMinDelayMs = 350, onEvent }) {
    this.chess = new Chess();
    this.playerName = playerName;
    this.playerColor = playerColor;
    this.botColor = playerColor === 'white' ? 'black' : 'white';
    this.botMinDelayMs = botMinDelayMs;
    this.onEvent = onEvent;
    this.gameId = 'local-bot';
    this.finished = false;
    this._botTimer = null;
    this._reqId = 0;
    this._pendingReqId = null;

    this.worker = null;
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./bot-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => this._onWorkerMessage(e.data);
        this.worker.onerror = (err) => {
          console.warn('bot worker error — falling back to main-thread compute', err);
          this.worker = null;
        };
      } catch (err) {
        console.warn('bot worker unavailable — falling back to main-thread compute', err);
        this.worker = null;
      }
    }
  }

  start() {
    this.onEvent('gameStart', {
      gameId: this.gameId,
      color: this.playerColor,
      opponentName: 'Bot',
      initialFen: this.chess.fen(),
    });
    if (this._currentColor() === this.botColor) this._scheduleBotMove();
  }

  sendMove(_gameId, from, to, promotion) {
    if (this.finished) return;
    if (this._currentColor() !== this.playerColor) {
      this.onEvent('invalidMove', { reason: 'not your turn' });
      return;
    }
    if (!this._applyMove(from, to, promotion)) return;
    if (!this.finished && this._currentColor() === this.botColor) this._scheduleBotMove();
  }

  resign() {
    if (this.finished) return;
    this.finished = true;
    this._cancelBotMove();
    const winner = this.playerColor === 'white' ? 'black' : 'white';
    this.onEvent('gameOver', { result: winner, reason: 'resign' });
  }

  // Bot doesn't use draw offers; respond immediately so the UI doesn't hang.
  offerDraw() { this.onEvent('drawDeclined', { gameId: this.gameId }); }
  acceptDraw() {}
  declineDraw() {}

  stop() {
    this.finished = true;
    this._cancelBotMove();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  _currentColor() {
    return this.chess.turn() === 'w' ? 'white' : 'black';
  }

  _applyMove(from, to, promotion) {
    let move;
    try {
      move = this.chess.move({ from, to, promotion: promotion ?? 'q' });
    } catch {
      this.onEvent('invalidMove', { reason: 'illegal move' });
      return false;
    }
    if (!move) {
      this.onEvent('invalidMove', { reason: 'illegal move' });
      return false;
    }
    const turn = this._currentColor();
    const movedColor = turn === 'white' ? 'black' : 'white';
    const isCheck = this.chess.inCheck();
    const isCheckmate = this.chess.isCheckmate();
    const isStalemate = this.chess.isStalemate();
    const isDraw = this.chess.isDraw();

    this.onEvent('moveMade', {
      from, to, promotion,
      fen: this.chess.fen(),
      turn,
      capturedPiece: move.captured,
      isCheck,
      lastMoveSan: move.san,
    });

    if (isCheckmate) {
      this.finished = true;
      this.onEvent('gameOver', { result: movedColor, reason: 'checkmate' });
    } else if (isStalemate) {
      this.finished = true;
      this.onEvent('gameOver', { result: 'draw', reason: 'stalemate' });
    } else if (isDraw) {
      this.finished = true;
      this.onEvent('gameOver', { result: 'draw', reason: 'draw' });
    }
    return true;
  }

  _scheduleBotMove() {
    this._cancelBotMove();
    const reqId = ++this._reqId;
    this._pendingReqId = reqId;

    // Tell the UI to show "Thinking…" before the (potentially long) search.
    this.onEvent('botThinking', { thinking: true });
    const startedAt = Date.now();
    const fen = this.chess.fen();

    const deliverMove = (move) => {
      if (this.finished || reqId !== this._pendingReqId) return;
      // Enforce a small minimum delay so very fast responses still feel like
      // the bot is "thinking" — avoids jarring instant moves in simple positions.
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, this.botMinDelayMs - elapsed);
      this._botTimer = setTimeout(() => {
        this._botTimer = null;
        if (this.finished) return;
        this.onEvent('botThinking', { thinking: false });
        if (move) this._applyMove(move.from, move.to, move.promotion);
      }, wait);
    };

    if (this.worker) {
      this._handleNextMove = (move) => deliverMove(move);
      this.worker.postMessage({ type: 'compute', fen, reqId });
    } else {
      // Fallback path: defer one frame so the "Thinking…" label paints first,
      // then compute on the main thread. UI will freeze during the search.
      setTimeout(() => {
        if (this.finished || reqId !== this._pendingReqId) return;
        deliverMove(selectBotMove(fen));
      }, 30);
    }
  }

  _onWorkerMessage(data) {
    if (!data || data.type !== 'result') return;
    if (data.reqId !== this._pendingReqId) return; // stale response
    const handler = this._handleNextMove;
    this._handleNextMove = null;
    handler?.(data.move);
  }

  _cancelBotMove() {
    if (this._botTimer) {
      clearTimeout(this._botTimer);
      this._botTimer = null;
    }
    // Bump pending id so any in-flight worker response is ignored.
    this._pendingReqId = null;
    this._handleNextMove = null;
  }
}
