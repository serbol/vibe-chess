import { Container } from 'pixi.js';
import { Chess } from 'chess.js';
import { socketClient } from './socket-client.js';
import { ui } from './ui.js';
import { LocalGame } from './bot.js';
import { startSnowfall, stopSnowfall } from './snowfall.js';
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
  token: null, // per-player rejoin token issued by the server on gameStart
  yourColor: null,
  yourName: '',
  opponentName: '',
  /** Last FEN confirmed by the server. */
  fen: new Chess().fen(),
  chess: new Chess(),
  lastMove: null, // { from, to, color }
  pendingFromTo: null, // optimistic-move guard: which {from,to} we're awaiting confirmation for
};

// localStorage key for the rejoin session — survives reloads and network drops
// so the player can recover a game by either reconnecting their socket or
// re-opening the tab within the server's reconnect window (2 min).
const SESSION_KEY = 'vibe-chess:session';

function saveSession() {
  if (!state.gameId || !state.token) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      gameId: state.gameId,
      token: state.token,
      yourColor: state.yourColor,
      yourName: state.yourName,
      opponentName: state.opponentName,
    }));
  } catch { /* storage unavailable — rejoin still works on same tab via in-memory state */ }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

let app, layers, board, highlights, pieces, effects;
let boardRoot;

// Either `socketClient` (online play) or a `LocalGame` (vs bot). Both expose
// the same sendMove/resign/offerDraw/etc. surface, so call sites don't branch.
let activeGame = null;

// Server (or LocalGame) → handler dispatch. Used by the socket layer at boot
// and re-used by LocalGame.onEvent for offline games.
const dispatch = {
  queued: () => ui.setLandingStatus('Queued — waiting for an opponent…'),
  gameStart: handleGameStart,
  gameRestored: handleGameRestored,
  rejoinFailed: handleRejoinFailed,
  moveMade: handleMoveMade,
  invalidMove: handleInvalidMove,
  gameOver: handleGameOver,
  opponentDisconnected: handleOpponentDisconnected,
  opponentReconnected: handleOpponentReconnected,
  drawOffered: handleDrawOffered,
  drawDeclined: () => ui.toast('Draw declined.'),
  botThinking: handleBotThinking,
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap() {
  // Decorative snowfall behind the landing screen — paused once a game starts.
  startSnowfall();

  // Pixi mount only once the game screen is in the DOM. We init lazily on first show.
  ui.onFindGame(handleFindGame);
  ui.onPlayBot(handlePlayBot);

  // PWA install prompt — Chrome/Edge fire `beforeinstallprompt` when the app
  // meets installability criteria (HTTPS, manifest, service worker, not
  // already installed). We stash the event and surface our own button so the
  // user can choose when to install instead of getting a generic browser banner.
  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    ui.setInstallAvailable(true);
  });
  ui.onInstall(async () => {
    if (!deferredInstallPrompt) return;
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    ui.setInstallAvailable(false);
    promptEvent.prompt();
    try {
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') ui.toast('Installing vibe.chess…');
    } catch { /* user dismissed or browser threw — no-op */ }
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    ui.setInstallAvailable(false);
    ui.toast('vibe.chess installed.');
  });

  // Offline mode: keep the menu and bot practice usable when the network is
  // down. Online matchmaking is gated by `handleFindGame` and the button is
  // visually disabled when offline.
  ui.setOnlineState(navigator.onLine);
  window.addEventListener('offline', () => ui.setOnlineState(false));
  window.addEventListener('online', () => {
    ui.setOnlineState(true);
    // If a session was sitting idle while offline, try to reconnect now.
    if (loadSession() && !socketClient.socket?.connected) {
      activeGame = socketClient;
      socketClient.connect();
    }
  });

  for (const [event, fn] of Object.entries(dispatch)) socketClient.on(event, fn);
  socketClient.on('connect_error', () => ui.setLandingStatus('Could not reach the server.'));

  // Connection-state banner: warning while disconnected, green flash on restore.
  // `wasDisconnected` ensures the first connect after page load doesn't flash
  // a misleading "Reconnected" — there was nothing to recover from.
  let wasDisconnected = false;
  socketClient.on('disconnect', () => {
    wasDisconnected = true;
    const msg = state.gameId
      ? 'Connection lost — reconnecting…'
      : 'Connection lost.';
    ui.connectionBanner(msg, 'warning');
  });
  socketClient.on('connect', () => {
    if (wasDisconnected) {
      wasDisconnected = false;
      ui.connectionBanner('Connection restored', 'success');
    }
    // If we have a saved session, attempt to rejoin. Covers both initial page
    // reloads and mid-game socket reconnects (Socket.IO fires `connect` again
    // after a successful reconnect).
    const session = loadSession();
    if (!session) return;
    activeGame = socketClient;
    // Restore the full session into in-memory state BEFORE the rejoin round-trip.
    // Without this, state.token stays null after reload so subsequent
    // saveSession() calls no-op, and state.yourColor stays null while
    // gameRestored is in flight — which lets a stale value win race conditions
    // and visibly flips the player's perspective on the board.
    state.gameId = session.gameId;
    state.token = session.token;
    state.yourColor = session.yourColor;
    state.yourName = session.yourName;
    state.opponentName = session.opponentName ?? '';
    socketClient.rejoinGame(session.gameId, session.token);
  });

  // If there's a saved session and we're online, kick off a reconnect attempt
  // immediately so the player can refresh the page mid-game and pick up where
  // they left off. When offline we wait for the `online` event above.
  if (loadSession() && navigator.onLine) {
    activeGame = socketClient;
    ui.setLandingStatus('Reconnecting to your game…');
    socketClient.connect();
  }
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
  if (!navigator.onLine) {
    ui.showOfflineAlert();
    return;
  }
  const name = ui.getNameInput();
  if (!name) {
    ui.setLandingStatus('Please enter a name.');
    return;
  }
  state.yourName = name;
  activeGame = socketClient;
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

function handlePlayBot(difficulty) {
  if (!difficulty) {
    ui.showDifficultyPicker((choice) => handlePlayBot(choice));
    return;
  }
  const name = ui.getNameInput() || 'You';
  state.yourName = name;
  // Random color so the player gets to practice both sides.
  const playerColor = Math.random() < 0.5 ? 'white' : 'black';
  activeGame = new LocalGame({
    playerName: name,
    playerColor,
    difficulty,
    onEvent: (event, payload) => dispatch[event]?.(payload),
  });
  activeGame.start();
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

async function handleGameStart(payload) {
  state.gameId = payload.gameId;
  state.token = payload.token ?? null;
  state.yourColor = payload.color;
  state.opponentName = payload.opponentName;
  state.fen = payload.initialFen;
  state.chess = new Chess(payload.initialFen);
  state.lastMove = null;
  state.pendingFromTo = null;
  saveSession();

  stopSnowfall();
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
  effects.clearCheckmate();

  // Resize once more after the screen swap (the mount has its final size now).
  fitBoardToScreen(app, boardRoot);
  effects.syncBaseTransform();

  // Wire the in-game buttons (idempotent: re-clicking the resign btn fine).
  ui.onResign(() => {
    if (!state.gameId) return;
    activeGame?.resign(state.gameId);
  });
  ui.onOfferDraw(() => {
    if (!state.gameId) return;
    activeGame?.offerDraw(state.gameId);
    ui.toast('Draw offer sent.');
  });
}

/**
 * Restore a game in progress after the socket reconnected or the page reloaded
 * within the server's reconnect window. The payload mirrors `gameStart` but
 * also includes the current FEN, last move, and SAN history so we can rebuild
 * the move list and the captured-pieces tray.
 */
async function handleGameRestored(payload) {
  // Token isn't echoed back on rejoin — keep the one we already have.
  state.gameId = payload.gameId;
  state.yourColor = payload.color;
  state.opponentName = payload.opponentName;
  state.fen = payload.fen;
  state.chess = new Chess(payload.fen);
  state.lastMove = payload.lastMove ?? null;
  state.pendingFromTo = null;
  saveSession();

  stopSnowfall();
  ui.showGame();
  ui.setPlayers(state.yourName, state.opponentName);
  ui.resetMoves();
  ui.resetCaptured();
  for (const m of payload.moveHistory ?? []) {
    ui.addMove(m.san, m.color);
    if (m.capturedPiece) {
      const capturedBy = m.color === state.yourColor ? 'you' : 'opp';
      const trayPiece = m.color === 'white' ? m.capturedPiece : m.capturedPiece.toUpperCase();
      ui.addCapturedPiece(capturedBy, trayPiece);
    }
  }
  updateTurnLabel();

  await ensurePixi();
  board.setFlipped(state.yourColor === 'black');
  pieces.setFromFen(state.fen);
  if (payload.lastMove) {
    highlights.setLastMove(payload.lastMove.from, payload.lastMove.to, payload.lastMove.color);
  } else {
    highlights.setLastMove(null, null);
  }
  highlights.clearLegalMoves();
  if (state.chess.inCheck()) {
    const kingSquare = findKingSquare(state.fen, payload.turn);
    highlights.setCheckGlow(kingSquare);
  } else {
    highlights.setCheckGlow(null);
  }
  effects.clearCheckmate();

  fitBoardToScreen(app, boardRoot);
  effects.syncBaseTransform();

  ui.onResign(() => {
    if (!state.gameId) return;
    activeGame?.resign(state.gameId);
  });
  ui.onOfferDraw(() => {
    if (!state.gameId) return;
    activeGame?.offerDraw(state.gameId);
    ui.toast('Draw offer sent.');
  });

  if (payload.drawOfferedBy && payload.drawOfferedBy !== state.yourColor) {
    handleDrawOffered();
  }

  // If the opponent is still offline, surface the warning again — the original
  // `opponentDisconnected` event may have fired before we reconnected.
  if (payload.opponentConnected === false) {
    handleOpponentDisconnected({ reconnectWindowMs: payload.reconnectWindowMs });
  } else {
    ui.hideConnectionBanner();
  }

  ui.toast('Reconnected to your game.');
}

function handleRejoinFailed() {
  clearSession();
  ui.toast('Your previous game has ended.');
  returnToLanding();
}

function handleOpponentDisconnected(payload) {
  // Live ticking countdown so the player can watch the reconnect window expire.
  ui.connectionBannerCountdown(
    'Opponent lost connection —',
    payload?.reconnectWindowMs ?? 120000,
    'warning',
  );
}

function handleOpponentReconnected() {
  ui.connectionBanner('Opponent reconnected', 'success');
}

function handleBotThinking({ thinking }) {
  if (thinking) {
    ui.setTurn('Frank is thinking…');
    ui.toast('Frank is thinking…', 0);
  } else {
    ui.hideToast();
    updateTurnLabel();
  }
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
  clearSession();
  ui.hideConnectionBanner();
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

  // Capture the mode now — `activeGame` is cleared by returnToLanding before
  // the user picks a button, so we have to remember which kind of game to start.
  const wasBotGame = activeGame && activeGame !== socketClient;
  const prevDifficulty = wasBotGame ? activeGame.difficulty : null;
  const onFindNew = () => {
    returnToLanding();
    if (wasBotGame) handlePlayBot(prevDifficulty);
    else handleFindGame();
  };

  // Dramatic checkmate sequence on the loser's king.
  if (reason === 'checkmate' && app) {
    const loserColor = result === 'white' ? 'black' : 'white';
    const kingSquare = findKingSquare(state.fen, loserColor);
    void effects.checkmate(kingSquare, board, result).then(() => {
      ui.showGameOver(title, detail, onFindNew, returnToLanding);
    });
  } else {
    ui.showGameOver(title, detail, onFindNew, returnToLanding);
  }

  state.gameId = null;
  state.token = null;
  state.yourColor = null;
}

function handleDrawOffered() {
  ui.showDrawOffered(
    () => state.gameId && activeGame?.acceptDraw(state.gameId),
    () => state.gameId && activeGame?.declineDraw(state.gameId),
  );
}

function returnToLanding() {
  clearSession();
  state.gameId = null;
  state.token = null;
  state.yourColor = null;
  state.fen = new Chess().fen();
  state.chess = new Chess();
  state.lastMove = null;
  state.pendingFromTo = null;
  if (activeGame && activeGame !== socketClient) activeGame.stop?.();
  activeGame = null;
  pieces?.setFromFen(state.fen);
  highlights?.setLastMove(null, null);
  highlights?.setCheckGlow(null);
  highlights?.clearLegalMoves();
  effects?.clearCheckmate();
  ui.showLanding();
  ui.setLandingStatus('');
  startSnowfall();
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
  activeGame?.sendMove(state.gameId, from, to);
}

function handlePromotion(from, to, choice) {
  highlights.clearLegalMoves();
  state.pendingFromTo = { from, to, promotion: choice };
  activeGame?.sendMove(state.gameId, from, to, choice);
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
