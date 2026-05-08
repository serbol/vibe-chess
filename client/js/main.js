import { Container } from 'pixi.js';
import { Chess } from 'chess.js';
import { socketClient } from './socket-client.js';
import { ui } from './ui.js';
import { createPixiApp } from './pixi/app.js';
import { loadAssets } from './pixi/assets.js';
import { Board, fitBoardToScreen, BOARD_LOGICAL_SIZE } from './pixi/board.js';
import { Highlights } from './pixi/highlights.js';
import { Pieces } from './pixi/pieces.js';
import { Effects } from './pixi/effects.js';
import { startTweenSystem } from './pixi/animations.js';

/**
 * Authoritative client state. The server is the source of truth for what
 * happened; we keep a local Chess() instance only for picking up which moves
 * are legal so we can show dots and avoid pointless server round-trips on
 * obviously invalid drops.
 */
const state = {
  gameId: null,
  yourColor: null,
  yourName: '',
  opponentName: '',
  /** Last FEN confirmed by the server. */
  fen: new Chess().fen(),
  chess: new Chess(),
  lastMove: null, // { from, to, color }
  pendingFromTo: null, // optimistic-move guard: which {from,to} we're awaiting confirmation for
};

let app, layers, board, highlights, pieces, effects;
let boardRoot;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap() {
  // Pixi mount only once the game screen is in the DOM. We init lazily on first show.
  ui.onFindGame(handleFindGame);

  socketClient.on('queued', () => ui.setLandingStatus('Queued — waiting for an opponent…'));
  socketClient.on('gameStart', handleGameStart);
  socketClient.on('moveMade', handleMoveMade);
  socketClient.on('invalidMove', handleInvalidMove);
  socketClient.on('gameOver', handleGameOver);
  socketClient.on('opponentDisconnected', () => ui.toast('Opponent disconnected.'));
  socketClient.on('drawOffered', handleDrawOffered);
  socketClient.on('drawDeclined', () => ui.toast('Draw declined.'));
  socketClient.on('connect_error', () => ui.setLandingStatus('Could not reach the server.'));
  socketClient.on('disconnect', () => ui.toast('Disconnected from server.'));
}

async function ensurePixi() {
  if (app) return;
  const mount = document.getElementById('pixi-mount');
  ({ app, layers } = await createPixiApp(mount));
  await loadAssets(app);
  startTweenSystem(app);

  // Single boardRoot under which board, highlights, pieces, and effects all live.
  // app stage already has the layers; we re-parent them under boardRoot for
  // shared scaling/centering.
  boardRoot = new Container({ label: 'boardRoot' });
  app.stage.addChild(boardRoot);
  for (const key of ['boardLayer', 'highlightLayer', 'pieceLayer', 'effectsLayer', 'dragLayer']) {
    app.stage.removeChild(layers[key]);
    boardRoot.addChild(layers[key]);
  }

  board = new Board(layers.boardLayer);
  highlights = new Highlights(layers.highlightLayer, board);
  effects = new Effects(app, layers.effectsLayer, boardRoot);
  pieces = new Pieces({
    pieceLayer: layers.pieceLayer,
    dragLayer: layers.dragLayer,
    board,
    getYourColor: () => state.yourColor,
    // While a move is pending server confirmation, return the OPPOSITE color so
    // pieces module disables interaction (it only drags when yourColor === turn).
    getCurrentTurn: () => {
      if (state.pendingFromTo) return state.yourColor === 'white' ? 'black' : 'white';
      return state.chess.turn() === 'w' ? 'white' : 'black';
    },
    onPickup: handlePickup,
    onDrop: handleDrop,
    onPromotion: handlePromotion,
  });

  app.ticker.add((ticker) => highlights.update(ticker.deltaMS / 1000));

  fitBoardToScreen(app, boardRoot);
  effects.syncBaseTransform();

  window.addEventListener('resize', () => {
    fitBoardToScreen(app, boardRoot);
    effects.syncBaseTransform();
  });
}

// ---------------------------------------------------------------------------
// Landing screen / queue
// ---------------------------------------------------------------------------

function handleFindGame() {
  const name = ui.getNameInput();
  if (!name) {
    ui.setLandingStatus('Please enter a name.');
    return;
  }
  state.yourName = name;
  ui.setLandingStatus('Connecting…');
  socketClient.connect();
  // Give the socket a tick to settle, then queue.
  const queueWhenReady = () => {
    if (socketClient.socket?.connected) {
      socketClient.joinQueue(name);
    } else {
      socketClient.socket?.once('connect', () => socketClient.joinQueue(name));
    }
  };
  queueWhenReady();
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

async function handleGameStart(payload) {
  state.gameId = payload.gameId;
  state.yourColor = payload.color;
  state.opponentName = payload.opponentName;
  state.fen = payload.initialFen;
  state.chess = new Chess(payload.initialFen);
  state.lastMove = null;
  state.pendingFromTo = null;

  ui.showGame();
  ui.setPlayers(state.yourName, state.opponentName);
  ui.resetMoves();
  ui.resetCaptured();
  updateTurnLabel();

  await ensurePixi();
  board.setFlipped(state.yourColor === 'black');
  pieces.setFromFen(state.fen);
  highlights.setLastMove(null, null);
  highlights.setCheckGlow(null);
  highlights.clearLegalMoves();

  // Resize once more after the screen swap (the mount has its final size now).
  fitBoardToScreen(app, boardRoot);
  effects.syncBaseTransform();

  // Wire the in-game buttons (idempotent: re-clicking the resign btn fine).
  ui.onResign(() => {
    if (!state.gameId) return;
    socketClient.resign(state.gameId);
  });
  ui.onOfferDraw(() => {
    if (!state.gameId) return;
    socketClient.offerDraw(state.gameId);
    ui.toast('Draw offer sent.');
  });
}

async function handleMoveMade(payload) {
  // Update local chess.js to mirror server.
  const prevFen = state.fen;
  state.fen = payload.fen;
  state.chess = new Chess(payload.fen);

  // Determine which color just moved (the side opposite to whose turn it now is).
  const movedColor = payload.turn === 'white' ? 'black' : 'white';
  const wasYourMove = movedColor === state.yourColor;

  // Animate from→to using the prev-FEN piece (we still have the pre-move sprite at `from`).
  const prevChess = new Chess(prevFen);
  const movedPiece = prevChess.get(payload.from); // { type, color } | false
  const pieceLetter = movedPiece
    ? (movedPiece.color === 'w' ? movedPiece.type.toUpperCase() : movedPiece.type)
    : 'P';

  // If the destination already had a piece, capture it visually (also handles en passant
  // imperfectly — the captured pawn for en passant isn't on `to`. We special-case below).
  if (payload.capturedPiece) {
    // En passant: pawn captured isn't on `to` — it's on the square one rank back.
    const isEp = movedPiece?.type === 'p'
      && payload.from[0] !== payload.to[0]
      && !prevChess.get(payload.to);
    if (isEp) {
      const epRank = movedColor === 'white' ? '5' : '4';
      const epSquare = payload.to[0] + epRank;
      void pieces.animateCapture(epSquare);
      effects.burstAt(epSquare, board, movedColor === 'white' ? 0x6aa2f1 : 0xf6c177);
    } else {
      void pieces.animateCapture(payload.to);
      effects.burstAt(payload.to, board, movedColor === 'white' ? 0x6aa2f1 : 0xf6c177);
    }
    effects.shake(5, 220);

    // Captured-piece tray.
    const trayPiece = movedColor === 'white'
      ? payload.capturedPiece // black piece captured by you (lower-case)
      : payload.capturedPiece.toUpperCase();
    ui.addCapturedPiece(wasYourMove ? 'you' : 'opp', trayPiece);
  }

  await pieces.animateMove(payload.from, payload.to, pieceLetter);

  // If this was castling, animate the rook too. chess.js sets the rook's position
  // in the new FEN automatically; we just need to play a slide animation.
  if (movedPiece?.type === 'k' && Math.abs(payload.from.charCodeAt(0) - payload.to.charCodeAt(0)) === 2) {
    const rank = payload.from[1];
    const isKingside = payload.to[0] === 'g';
    const rookFrom = (isKingside ? 'h' : 'a') + rank;
    const rookTo = (isKingside ? 'f' : 'd') + rank;
    const rookLetter = movedColor === 'white' ? 'R' : 'r';
    await pieces.animateMove(rookFrom, rookTo, rookLetter);
  }

  // Reconcile sprites with the new FEN (handles promotion, en passant, etc.).
  pieces.setFromFen(payload.fen);

  state.lastMove = { from: payload.from, to: payload.to, color: movedColor };
  highlights.setLastMove(payload.from, payload.to, movedColor);
  highlights.clearLegalMoves();

  // Check glow on the now-to-move side's king if in check.
  if (payload.isCheck) {
    const kingSquare = findKingSquare(payload.fen, payload.turn);
    highlights.setCheckGlow(kingSquare);
  } else {
    highlights.setCheckGlow(null);
  }

  ui.addMove(payload.lastMoveSan, movedColor);
  state.pendingFromTo = null;
  updateTurnLabel();
}

function handleInvalidMove({ reason }) {
  ui.toast(`Invalid move: ${reason}`);
  // Snap any in-flight piece back. The piece module already snaps on a failed drop,
  // but if we sent a legal-looking move that the server rejected (race), we re-render.
  pieces.setFromFen(state.fen);
  state.pendingFromTo = null;
}

function handleGameOver({ result, reason }) {
  let title;
  let detail;
  if (result === 'draw') {
    title = 'Draw';
    detail = reason === 'stalemate' ? 'Stalemate.' : 'Game drawn.';
  } else {
    const youWon = result === state.yourColor;
    title = youWon ? 'You win' : 'You lose';
    detail = reason === 'checkmate'
      ? 'by checkmate'
      : reason === 'resign' ? 'by resignation' : reason;
  }

  // Dramatic checkmate sequence on the loser's king.
  if (reason === 'checkmate' && app) {
    const loserColor = result === 'white' ? 'black' : 'white';
    const kingSquare = findKingSquare(state.fen, loserColor);
    void effects.checkmate(kingSquare, board, result).then(() => {
      ui.showGameOver(title, detail, returnToLanding);
    });
  } else {
    ui.showGameOver(title, detail, returnToLanding);
  }

  state.gameId = null;
  state.yourColor = null;
}

function handleDrawOffered() {
  ui.showDrawOffered(
    () => state.gameId && socketClient.acceptDraw(state.gameId),
    () => state.gameId && socketClient.declineDraw(state.gameId),
  );
}

function returnToLanding() {
  state.fen = new Chess().fen();
  state.chess = new Chess();
  state.lastMove = null;
  pieces?.setFromFen(state.fen);
  highlights?.setLastMove(null, null);
  highlights?.setCheckGlow(null);
  highlights?.clearLegalMoves();
  ui.showLanding();
  ui.setLandingStatus('');
}

// ---------------------------------------------------------------------------
// Drag handlers
// ---------------------------------------------------------------------------

function handlePickup(square) {
  const yourTurn = state.chess.turn() === (state.yourColor === 'white' ? 'w' : 'b');
  if (!yourTurn) return;
  const moves = state.chess.moves({ square, verbose: true });
  highlights.setLegalMoves(moves.map((m) => ({ to: m.to, isCapture: !!m.captured })));
}

function handleDrop(from, to) {
  highlights.clearLegalMoves();
  if (!from || !to) return;

  // Reject obviously illegal moves locally. The server still re-validates.
  const legal = state.chess.moves({ square: from, verbose: true })
    .some((m) => m.to === to);
  if (!legal) {
    pieces.setFromFen(state.fen); // snap everything back to truth
    return;
  }

  state.pendingFromTo = { from, to };
  socketClient.sendMove(state.gameId, from, to);
}

function handlePromotion(from, to, choice) {
  highlights.clearLegalMoves();
  state.pendingFromTo = { from, to, promotion: choice };
  socketClient.sendMove(state.gameId, from, to, choice);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateTurnLabel() {
  const turnColor = state.chess.turn() === 'w' ? 'white' : 'black';
  const youAre = state.yourColor === turnColor ? ' (your turn)' : '';
  const label = `${turnColor === 'white' ? 'White' : 'Black'} to move${youAre}`;
  ui.setTurn(label);
}

function findKingSquare(fen, color) {
  const c = new Chess(fen);
  const target = color === 'white' ? 'K' : 'k';
  const board2d = c.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board2d[r][f];
      if (!cell) continue;
      const letter = cell.color === 'w' ? cell.type.toUpperCase() : cell.type;
      if (letter === target) {
        const file = String.fromCharCode('a'.charCodeAt(0) + f);
        const rank = String(8 - r);
        return file + rank;
      }
    }
  }
  return null;
}

void bootstrap();
