import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Color, GameState, MoveRecord, PlayerSlot } from '../types/chess.types';
import { ChessEngineService } from './chess-engine.service';

interface QueuedPlayer {
  socketId: string;
  name: string;
}

export const RECONNECT_WINDOW_MS = 120_000;

export interface RejoinResult {
  game: GameState;
  color: Color;
  opponentName: string;
  reconnected: boolean;
}

/**
 * In-memory matchmaking + game state. Single-instance only — if scaled
 * horizontally, replace the in-process maps with Redis (and use the
 * Socket.IO Redis adapter for fan-out).
 */
@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);
  private readonly queue: QueuedPlayer[] = [];
  private readonly games = new Map<string, GameState>();
  private readonly socketToGame = new Map<string, string>();

  constructor(private readonly engine: ChessEngineService) {}

  /**
   * Adds a player to the queue and pairs them with another waiting player
   * if one exists. Returns the new game when a match is made.
   */
  enqueue(socketId: string, name: string): GameState | null {
    if (this.socketToGame.has(socketId)) return null;
    if (this.queue.some((p) => p.socketId === socketId)) return null;

    const opponent = this.queue.shift();
    if (!opponent) {
      this.queue.push({ socketId, name });
      return null;
    }

    // Randomize colors so the same socket isn't always white.
    const whiteFirst = Math.random() < 0.5;
    const game: GameState = {
      gameId: randomUUID(),
      white: {
        socketId: whiteFirst ? opponent.socketId : socketId,
        name: whiteFirst ? opponent.name : name,
        color: 'white',
        token: randomUUID(),
        connected: true,
      },
      black: {
        socketId: whiteFirst ? socketId : opponent.socketId,
        name: whiteFirst ? name : opponent.name,
        color: 'black',
        token: randomUUID(),
        connected: true,
      },
      fen: this.engine.newGameFen(),
      turn: 'white',
      finished: false,
      startedAt: Date.now(),
      moveHistory: [],
      disconnectTimers: {},
    };

    this.games.set(game.gameId, game);
    this.socketToGame.set(game.white.socketId, game.gameId);
    this.socketToGame.set(game.black.socketId, game.gameId);
    this.logger.log(`Match: ${game.white.name} (W) vs ${game.black.name} (B) [${game.gameId}]`);
    return game;
  }

  removeFromQueue(socketId: string): void {
    const idx = this.queue.findIndex((p) => p.socketId === socketId);
    if (idx >= 0) this.queue.splice(idx, 1);
  }

  getGame(gameId: string): GameState | undefined {
    return this.games.get(gameId);
  }

  getGameForSocket(socketId: string): GameState | undefined {
    const id = this.socketToGame.get(socketId);
    return id ? this.games.get(id) : undefined;
  }

  /** Returns the player's color in this game, or null if they're not in it. */
  colorOf(game: GameState, socketId: string): Color | null {
    if (game.white.socketId === socketId) return 'white';
    if (game.black.socketId === socketId) return 'black';
    return null;
  }

  opponentSocketId(game: GameState, socketId: string): string | null {
    const color = this.colorOf(game, socketId);
    if (!color) return null;
    const opp = color === 'white' ? game.black : game.white;
    return opp.connected ? opp.socketId : null;
  }

  setFen(game: GameState, fen: string, turn: Color): void {
    game.fen = fen;
    game.turn = turn;
  }

  recordMove(game: GameState, move: MoveRecord): void {
    game.moveHistory.push(move);
    game.lastMove = { from: move.from, to: move.to, color: move.color };
  }

  /**
   * Marks the player as disconnected and detaches their socket mapping, but
   * keeps the game alive so the player can rejoin via [[rejoin]] within the
   * reconnect window. Returns the player slot that disconnected, or null if
   * the socket wasn't in any game.
   */
  markDisconnected(socketId: string): { game: GameState; slot: PlayerSlot } | null {
    const game = this.getGameForSocket(socketId);
    if (!game || game.finished) return null;
    const color = this.colorOf(game, socketId);
    if (!color) return null;
    const slot = color === 'white' ? game.white : game.black;
    slot.connected = false;
    slot.disconnectedAt = Date.now();
    this.socketToGame.delete(socketId);
    return { game, slot };
  }

  /**
   * Schedule the game to end if the player doesn't reconnect within
   * RECONNECT_WINDOW_MS. The caller passes a callback that fires on timeout.
   * Replaces any pending timer for that color.
   */
  scheduleDisconnectTimeout(game: GameState, color: Color, onTimeout: () => void): void {
    const existing = game.disconnectTimers[color];
    if (existing) clearTimeout(existing);
    game.disconnectTimers[color] = setTimeout(onTimeout, RECONNECT_WINDOW_MS);
  }

  cancelDisconnectTimeout(game: GameState, color: Color): void {
    const t = game.disconnectTimers[color];
    if (t) {
      clearTimeout(t);
      game.disconnectTimers[color] = undefined;
    }
  }

  /**
   * Re-attach a player to their game using the gameId + per-player token issued
   * at gameStart. Returns null if the game doesn't exist, the token doesn't match,
   * or the game is already over.
   */
  rejoin(gameId: string, token: string, newSocketId: string): RejoinResult | null {
    const game = this.games.get(gameId);
    if (!game || game.finished) return null;

    let slot: PlayerSlot | null = null;
    if (game.white.token === token) slot = game.white;
    else if (game.black.token === token) slot = game.black;
    if (!slot) return null;

    const wasDisconnected = !slot.connected;

    // Update the socket mapping. If the player was reconnected on a different
    // socket already (e.g. opened in two tabs), drop the old mapping.
    if (slot.socketId && slot.socketId !== newSocketId) {
      this.socketToGame.delete(slot.socketId);
    }
    slot.socketId = newSocketId;
    slot.connected = true;
    slot.disconnectedAt = undefined;
    this.socketToGame.set(newSocketId, gameId);
    this.cancelDisconnectTimeout(game, slot.color);

    const opponent = slot.color === 'white' ? game.black : game.white;
    return {
      game,
      color: slot.color,
      opponentName: opponent.name,
      reconnected: wasDisconnected,
    };
  }

  endGame(gameId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;
    game.finished = true;
    if (game.disconnectTimers.white) clearTimeout(game.disconnectTimers.white);
    if (game.disconnectTimers.black) clearTimeout(game.disconnectTimers.black);
    game.disconnectTimers = {};
    this.socketToGame.delete(game.white.socketId);
    this.socketToGame.delete(game.black.socketId);
    this.games.delete(gameId);
  }
}
