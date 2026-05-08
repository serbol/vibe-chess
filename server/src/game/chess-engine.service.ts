import { Injectable } from '@nestjs/common';
import { Chess } from 'chess.js';
import type { Color, MoveError, MoveResult, PromotionPiece } from '../types/chess.types';

@Injectable()
export class ChessEngineService {
  newGameFen(): string {
    return new Chess().fen();
  }

  /**
   * Apply a move from `from` to `to` (with optional promotion) on top of the
   * provided FEN. Returns the new FEN and end-state flags, or an error reason.
   * The engine is the source of truth — every move from a client is re-validated here.
   */
  applyMove(
    fen: string,
    from: string,
    to: string,
    promotion: PromotionPiece | undefined,
    expectedTurn: Color,
  ): MoveResult | MoveError {
    const chess = new Chess(fen);

    if ((chess.turn() === 'w' ? 'white' : 'black') !== expectedTurn) {
      return { ok: false, reason: 'not your turn' };
    }

    let move;
    try {
      move = chess.move({ from, to, promotion: promotion ?? 'q' });
    } catch {
      return { ok: false, reason: 'illegal move' };
    }
    if (!move) return { ok: false, reason: 'illegal move' };

    const isCheck = chess.inCheck();
    const isCheckmate = chess.isCheckmate();
    const isStalemate = chess.isStalemate();
    const isDraw = chess.isDraw();

    let drawReason: MoveResult['drawReason'];
    if (isStalemate) drawReason = 'stalemate';
    else if (chess.isThreefoldRepetition()) drawReason = 'threefold';
    else if (chess.isInsufficientMaterial()) drawReason = 'insufficient';
    else if (isDraw) drawReason = '50-move';

    return {
      ok: true,
      fen: chess.fen(),
      turn: chess.turn() === 'w' ? 'white' : 'black',
      capturedPiece: move.captured,
      isCheck,
      isCheckmate,
      isStalemate,
      isDraw,
      drawReason,
      san: move.san,
    };
  }
}
