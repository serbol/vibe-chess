import { Chess } from 'chess.js';

// ---------------------------------------------------------------------------
// Engine: negamax + alpha-beta with quiescence on captures.
// "Medium" bot — depth 2 main search + 2-ply quiescence. Sees one
// capture/recapture sequence so it doesn't drop pieces in obvious trades,
// but won't find longer tactical combinations. Suitable for training.
// ---------------------------------------------------------------------------

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables in centipawns, indexed 0..63 from a8..h1 (white perspective).
// Black squares are mirrored vertically at lookup time.
const PST_P = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
const PST_N = [
 -50,-40,-30,-30,-30,-30,-40,-50,
 -40,-20,  0,  0,  0,  0,-20,-40,
 -30,  0, 10, 15, 15, 10,  0,-30,
 -30,  5, 15, 20, 20, 15,  5,-30,
 -30,  0, 15, 20, 20, 15,  0,-30,
 -30,  5, 10, 15, 15, 10,  5,-30,
 -40,-20,  0,  5,  5,  0,-20,-40,
 -50,-40,-30,-30,-30,-30,-40,-50,
];
const PST_B = [
 -20,-10,-10,-10,-10,-10,-10,-20,
 -10,  0,  0,  0,  0,  0,  0,-10,
 -10,  0,  5, 10, 10,  5,  0,-10,
 -10,  5,  5, 10, 10,  5,  5,-10,
 -10,  0, 10, 10, 10, 10,  0,-10,
 -10, 10, 10, 10, 10, 10, 10,-10,
 -10,  5,  0,  0,  0,  0,  5,-10,
 -20,-10,-10,-10,-10,-10,-10,-20,
];
const PST_R = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
const PST_Q = [
 -20,-10,-10, -5, -5,-10,-10,-20,
 -10,  0,  0,  0,  0,  0,  0,-10,
 -10,  0,  5,  5,  5,  5,  0,-10,
  -5,  0,  5,  5,  5,  5,  0, -5,
   0,  0,  5,  5,  5,  5,  0, -5,
 -10,  5,  5,  5,  5,  5,  0,-10,
 -10,  0,  5,  0,  0,  0,  0,-10,
 -20,-10,-10, -5, -5,-10,-10,-20,
];
const PST_K = [
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -20,-30,-30,-40,-40,-30,-30,-20,
 -10,-20,-20,-20,-20,-20,-20,-10,
  20, 20,  0,  0,  0,  0, 20, 20,
  20, 30, 10,  0,  0, 10, 30, 20,
];
const PST = { p: PST_P, n: PST_N, b: PST_B, r: PST_R, q: PST_Q, k: PST_K };

function evaluate(chess) {
  // Score in centipawns from white's perspective.
  let score = 0;
  const board = chess.board(); // [rank8..rank1][fileA..fileH]
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (!piece) continue;
      const value = PIECE_VALUES[piece.type];
      // PST is white-perspective: white reads index r*8+f directly,
      // black reads it mirrored across the horizontal midline.
      const idx = piece.color === 'w' ? r * 8 + f : (7 - r) * 8 + f;
      const pst = PST[piece.type][idx];
      score += (piece.color === 'w' ? 1 : -1) * (value + pst);
    }
  }
  return score;
}

// MVV-LVA: capture most valuable victim with least valuable attacker.
function moveOrder(move) {
  if (!move.captured) return 0;
  return 10 * PIECE_VALUES[move.captured] - PIECE_VALUES[move.piece];
}

function quiesce(chess, alpha, beta, perspective, qDepth) {
  const standPat = perspective * evaluate(chess);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  if (qDepth === 0) return alpha;

  const captures = chess.moves({ verbose: true }).filter((m) => m.captured);
  captures.sort((a, b) => moveOrder(b) - moveOrder(a));
  for (const move of captures) {
    chess.move(move);
    const score = -quiesce(chess, -beta, -alpha, -perspective, qDepth - 1);
    chess.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(chess, depth, alpha, beta, perspective) {
  if (chess.isCheckmate()) return -100000 - depth;
  if (chess.isStalemate() || chess.isDraw()) return 0;
  if (depth === 0) return quiesce(chess, alpha, beta, perspective, 2);

  const moves = chess.moves({ verbose: true });
  moves.sort((a, b) => moveOrder(b) - moveOrder(a));

  let best = -Infinity;
  for (const move of moves) {
    chess.move(move);
    const score = -negamax(chess, depth - 1, -beta, -alpha, -perspective);
    chess.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function selectBotMove(fen, depth = 2) {
  const chess = new Chess(fen);
  const perspective = chess.turn() === 'w' ? 1 : -1;
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;
  moves.sort((a, b) => moveOrder(b) - moveOrder(a));

  let alpha = -Infinity;
  const beta = Infinity;
  const scored = [];
  for (const move of moves) {
    chess.move(move);
    const score = -negamax(chess, depth - 1, -beta, -alpha, -perspective);
    chess.undo();
    scored.push({ move, score });
    if (score > alpha) alpha = score;
  }
  // Random tiebreak among near-equal moves so games aren't deterministic.
  const bestScore = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score >= bestScore - 10);
  return top[Math.floor(Math.random() * top.length)].move;
}

// ---------------------------------------------------------------------------
// LocalGame: emulates the server's event protocol for a single human-vs-bot
// game. Same method names as socketClient (sendMove/resign/offerDraw/etc.)
// so main.js can treat it as a drop-in replacement.
// ---------------------------------------------------------------------------

export class LocalGame {
  constructor({ playerName, playerColor = 'white', botDelayMs = 500, depth = 2, onEvent }) {
    this.chess = new Chess();
    this.playerName = playerName;
    this.playerColor = playerColor;
    this.botColor = playerColor === 'white' ? 'black' : 'white';
    this.botDelayMs = botDelayMs;
    this.depth = depth;
    this.onEvent = onEvent;
    this.gameId = 'local-bot';
    this.finished = false;
    this._botTimer = null;
  }

  start() {
    this.onEvent('gameStart', {
      gameId: this.gameId,
      color: this.playerColor,
      opponentName: 'Bot (Medium)',
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
    this._botTimer = setTimeout(() => {
      this._botTimer = null;
      if (this.finished) return;
      const move = selectBotMove(this.chess.fen(), this.depth);
      if (!move) return;
      this._applyMove(move.from, move.to, move.promotion);
    }, this.botDelayMs);
  }

  _cancelBotMove() {
    if (this._botTimer) {
      clearTimeout(this._botTimer);
      this._botTimer = null;
    }
  }
}
