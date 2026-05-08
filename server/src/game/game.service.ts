import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Color, GameState } from '../types/chess.types';
import { ChessEngineService } from './chess-engine.service';

interface QueuedPlayer {
  socketId: string;
  name: string;
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
      },
      black: {
        socketId: whiteFirst ? socketId : opponent.socketId,
        name: whiteFirst ? name : opponent.name,
        color: 'black',
      },
      fen: this.engine.newGameFen(),
      turn: 'white',
      finished: false,
      startedAt: Date.now(),
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
    if (game.white.socketId === socketId) return game.black.socketId;
    if (game.black.socketId === socketId) return game.white.socketId;
    return null;
  }

  setFen(game: GameState, fen: string, turn: Color): void {
    game.fen = fen;
    game.turn = turn;
  }

  endGame(gameId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;
    game.finished = true;
    this.socketToGame.delete(game.white.socketId);
    this.socketToGame.delete(game.black.socketId);
    this.games.delete(gameId);
  }
}
