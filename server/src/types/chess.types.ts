export type Color = 'white' | 'black';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface PlayerSlot {
  socketId: string;
  name: string;
  color: Color;
  token: string;
  connected: boolean;
  /** Timestamp (ms) when the player went offline; undefined while connected. */
  disconnectedAt?: number;
}

export interface MoveRecord {
  from: string;
  to: string;
  promotion?: PromotionPiece;
  san: string;
  fen: string;
  color: Color;
  capturedPiece?: string;
  isCheck: boolean;
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
  moveHistory: MoveRecord[];
  lastMove?: { from: string; to: string; color: Color };
  disconnectTimers: { white?: NodeJS.Timeout; black?: NodeJS.Timeout };
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
