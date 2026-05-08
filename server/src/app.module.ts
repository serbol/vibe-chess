import { Module } from '@nestjs/common';
import { GameModule } from './game/game.module';
import { HealthController } from './health.controller';

@Module({
  imports: [GameModule],
  controllers: [HealthController],
})
export class AppModule {}
