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
import { ChatDto, GameIdDto, MoveDto } from './dto/move.dto';
import { JoinGameDto } from './dto/join-game.dto';
import { GameService } from './game.service';

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

    const game = this.games.getGameForSocket(client.id);
    if (!game || game.finished) return;

    const opponentId = this.games.opponentSocketId(game, client.id);
    if (opponentId) {
      this.server.to(opponentId).emit('opponentDisconnected', { gameId: game.gameId });
      // MVP: end the game immediately on disconnect. Reconnect-within-30s is a stretch goal.
      const winner = this.games.colorOf(game, client.id) === 'white' ? 'black' : 'white';
      this.server
        .to(opponentId)
        .emit('gameOver', { result: winner, reason: 'resign' });
    }
    this.games.endGame(game.gameId);
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
      color: 'white',
      opponentName: game.black.name,
      initialFen: game.fen,
    });
    this.server.to(game.black.socketId).emit('gameStart', {
      gameId: game.gameId,
      color: 'black',
      opponentName: game.white.name,
      initialFen: game.fen,
    });
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
