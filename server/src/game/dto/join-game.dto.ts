import { IsString, Length } from 'class-validator';

export class JoinGameDto {
  @IsString()
  @Length(1, 24)
  playerName!: string;
}
