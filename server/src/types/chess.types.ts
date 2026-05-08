export type Color = 'white' | 'black';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface PlayerSlot {
  socketId: string;
  name: string;
  color: Color;
}

export interface GameState {
  gameId: string;
  white: PlayerSlot;
  black: PlayerSlot;
  fen: string;
  turn: Color;
  drawOfferedBy?: Color;
  finished: boolean;
  startedAt: number;
}

export interface MoveResult {
  ok: true;
  fen: string;
  turn: Color;
  capturedPiece?: string;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  drawReason?: 'stalemate' | 'threefold' | '50-move' | 'insufficient';
  san: string;
}

export interface MoveError {
  ok: false;
  reason: string;
}
