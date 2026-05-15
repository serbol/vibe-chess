import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChessEngineService } from './chess-engine.service';
import { ChatDto, GameIdDto, MoveDto, RejoinGameDto } from './dto/move.dto';
import { JoinGameDto } from './dto/join-game.dto';
import { GameService, RECONNECT_WINDOW_MS } from './game.service';

const corsOrigin = process.env.CLIENT_ORIGIN ?? '*';

@WebSocketGateway({
  cors: { origin: corsOrigin, credentials: false },
})
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger(GameGateway.name);

  constructor(
    private readonly games: GameService,
    private readonly engine: ChessEngineService,
  ) {}

  handleConnection(client: Socket): void {
    this.logger.log(`connected ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`disconnected ${client.id}`);
    this.games.removeFromQueue(client.id);

    const result = this.games.markDisconnected(client.id);
    if (!result) return;
    const { game, slot } = result;

    const opponent = slot.color === 'white' ? game.black : game.white;
    if (opponent.connected) {
      this.server.to(opponent.socketId).emit('opponentDisconnected', {
        gameId: game.gameId,
        reconnectWindowMs: RECONNECT_WINDOW_MS,
      });
    }

    // Give the player RECONNECT_WINDOW_MS to come back via `rejoinGame`.
    // If they don't, end the game in favor of the opponent.
    this.games.scheduleDisconnectTimeout(game, slot.color, () => {
      if (game.finished) return;
      const winner = slot.color === 'white' ? 'black' : 'white';
      const opp = slot.color === 'white' ? game.black : game.white;
      if (opp.connected) {
        this.server.to(opp.socketId).emit('gameOver', { result: winner, reason: 'resign' });
      }
      this.games.endGame(game.gameId);
    });
  }

  @SubscribeMessage('joinQueue')
  onJoinQueue(@ConnectedSocket() client: Socket, @MessageBody() body: JoinGameDto): void {
    const game = this.games.enqueue(client.id, body.playerName);
    if (!game) {
      client.emit('queued', { ok: true });
      return;
    }

    // Match found — both sockets join the room and receive their color.
    void this.server.in(game.white.socketId).socketsJoin(game.gameId);
    void this.server.in(game.black.socketId).socketsJoin(game.gameId);

    this.server.to(game.white.socketId).emit('gameStart', {
      gameId: game.gameId,
      token: game.white.token,
      color: 'white',
      opponentName: game.black.name,
      initialFen: game.fen,
    });
    this.server.to(game.black.socketId).emit('gameStart', {
      gameId: game.gameId,
      token: game.black.token,
      color: 'black',
      opponentName: game.white.name,
      initialFen: game.fen,
    });
  }

  @SubscribeMessage('rejoinGame')
  onRejoinGame(@ConnectedSocket() client: Socket, @MessageBody() body: RejoinGameDto): void {
    const result = this.games.rejoin(body.gameId, body.token, client.id);
    if (!result) {
      client.emit('rejoinFailed', { gameId: body.gameId, reason: 'game not found or already ended' });
      return;
    }
    const { game, color, opponentName, reconnected } = result;
    void this.server.in(client.id).socketsJoin(game.gameId);

    const opponent = color === 'white' ? game.black : game.white;
    // If the opponent is offline, report the time still left in their reconnect
    // window so the client's countdown is accurate, not just the full 2 min.
    const opponentRemainingMs = opponent.connected
      ? RECONNECT_WINDOW_MS
      : Math.max(0, RECONNECT_WINDOW_MS - (Date.now() - (opponent.disconnectedAt ?? Date.now())));
    client.emit('gameRestored', {
      gameId: game.gameId,
      color,
      opponentName,
      opponentConnected: opponent.connected,
      reconnectWindowMs: opponentRemainingMs,
      fen: game.fen,
      turn: game.turn,
      lastMove: game.lastMove ?? null,
      moveHistory: game.moveHistory.map((m) => ({
        from: m.from,
        to: m.to,
        promotion: m.promotion,
        san: m.san,
        color: m.color,
        capturedPiece: m.capturedPiece,
        isCheck: m.isCheck,
      })),
      drawOfferedBy: game.drawOfferedBy ?? null,
    });

    if (reconnected) {
      const opp = color === 'white' ? game.black : game.white;
      if (opp.connected && opp.socketId !== client.id) {
        this.server.to(opp.socketId).emit('opponentReconnected', { gameId: game.gameId });
      }
    }
  }

  @SubscribeMessage('move')
  onMove(@ConnectedSocket() client: Socket, @MessageBody() body: MoveDto): void {
    const game = this.games.getGame(body.gameId);
    if (!game || game.finished) {
      client.emit('invalidMove', { reason: 'no such game' });
      return;
    }

    const color = this.games.colorOf(game, client.id);
    if (!color) {
      client.emit('invalidMove', { reason: 'not a player in this game' });
      return;
    }

    const result = this.engine.applyMove(game.fen, body.from, body.to, body.promotion, color);
    if (!result.ok) {
      client.emit('invalidMove', { reason: result.reason });
      return;
    }

    this.games.setFen(game, result.fen, result.turn);
    this.games.recordMove(game, {
      from: body.from,
      to: body.to,
      promotion: body.promotion,
      san: result.san,
      fen: result.fen,
      color,
      capturedPiece: result.capturedPiece,
      isCheck: result.isCheck,
    });

    this.server.to(game.gameId).emit('moveMade', {
      from: body.from,
      to: body.to,
      promotion: body.promotion,
      fen: result.fen,
      turn: result.turn,
      capturedPiece: result.capturedPiece,
      isCheck: result.isCheck,
      lastMoveSan: result.san,
    });

    if (result.isCheckmate) {
      // The side that just moved (color) is the winner.
      this.server.to(game.gameId).emit('gameOver', { result: color, reason: 'checkmate' });
      this.games.endGame(game.gameId);
    } else if (result.isStalemate) {
      this.server.to(game.gameId).emit('gameOver', { result: 'draw', reason: 'stalemate' });
      this.games.endGame(game.gameId);
    } else if (result.isDraw) {
      this.server.to(game.gameId).emit('gameOver', { result: 'draw', reason: 'draw' });
      this.games.endGame(game.gameId);
    }
  }

  @SubscribeMessage('resign')
  onResign(@ConnectedSocket() client: Socket, @MessageBody() body: GameIdDto): void {
    const game = this.games.getGame(body.gameId);
    if (!game || game.finished) return;
    const color = this.games.colorOf(game, client.id);
    if (!color) return;

    const winner = color === 'white' ? 'black' : 'white';
    this.server.to(game.gameId).emit('gameOver', { result: winner, reason: 'resign' });
    this.games.endGame(game.gameId);
  }

  @SubscribeMessage('offerDraw')
  onOfferDraw(@ConnectedSocket() client: Socket, @MessageBody() body: GameIdDto): void {
    const game = this.games.getGame(body.gameId);
    if (!game || game.finished) return;
    const color = this.games.colorOf(game, client.id);
    if (!color) return;

    game.drawOfferedBy = color;
    const opponentId = this.games.opponentSocketId(game, client.id);
    if (opponentId) this.server.to(opponentId).emit('drawOffered', { gameId: game.gameId });
  }

  @SubscribeMessage('acceptDraw')
  onAcceptDraw(@ConnectedSocket() client: Socket, @MessageBody() body: GameIdDto): void {
    const game = this.games.getGame(body.gameId);
    if (!game || game.finished || !game.drawOfferedBy) return;
    if (this.games.colorOf(game, client.id) === game.drawOfferedBy) return; // can't accept own offer

    this.server.to(game.gameId).emit('gameOver', { result: 'draw', reason: 'draw' });
    this.games.endGame(game.gameId);
  }

  @SubscribeMessage('declineDraw')
  onDeclineDraw(@ConnectedSocket() client: Socket, @MessageBody() body: GameIdDto): void {
    const game = this.games.getGame(body.gameId);
    if (!game || game.finished) return;
    game.drawOfferedBy = undefined;
    const opponentId = this.games.opponentSocketId(game, client.id);
    if (opponentId) this.server.to(opponentId).emit('drawDeclined', { gameId: game.gameId });
  }

  @SubscribeMessage('chatMessage')
  onChat(@ConnectedSocket() client: Socket, @MessageBody() body: ChatDto): void {
    const game = this.games.getGame(body.gameId);
    if (!game) return;
    const color = this.games.colorOf(game, client.id);
    if (!color) return;
    const text = body.text.slice(0, 280);
    this.server.to(game.gameId).emit('chatMessage', { from: color, text });
  }
}
