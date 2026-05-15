import { Chess } from 'chess.js';

// ---------------------------------------------------------------------------
// Engine: negamax + alpha-beta with quiescence on captures.
// Depth 3 + 2-ply quiescence — plays tactically sound chess (sees one
// capture/recapture sequence so it won't drop pieces in obvious trades).
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
  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (!piece) continue;
      const value = PIECE_VALUES[piece.type];
      const idx = piece.color === 'w' ? r * 8 + f : (7 - r) * 8 + f;
      const pst = PST[piece.type][idx];
      score += (piece.color === 'w' ? 1 : -1) * (value + pst);
    }
  }
  return score;
}

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

const SEARCH_DEPTH = 3;
const TIEBREAK_MARGIN = 5;

export function selectBotMove(fen) {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;

  const perspective = chess.turn() === 'w' ? 1 : -1;
  moves.sort((a, b) => moveOrder(b) - moveOrder(a));

  // Root moves must be searched with a FULL window. A shrinking root alpha
  // makes alpha-beta return upper-bound scores for worse moves, which then
  // look "tied" with the best one and lets the tiebreak filter pick badly.
  const scored = [];
  for (const move of moves) {
    chess.move(move);
    const score = -negamax(chess, SEARCH_DEPTH - 1, -Infinity, Infinity, -perspective);
    chess.undo();
    scored.push({ move, score });
  }
  const bestScore = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score >= bestScore - TIEBREAK_MARGIN);
  return top[(Math.random() * top.length) | 0].move;
}
