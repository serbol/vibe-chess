import { Module } from '@nestjs/common';
import { ChessEngineService } from './chess-engine.service';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';

@Module({
  providers: [GameGateway, GameService, ChessEngineService],
})
export class GameModule {}
