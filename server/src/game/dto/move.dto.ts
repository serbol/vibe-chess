import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

const SQUARE = /^[a-h][1-8]$/;

export class MoveDto {
  @IsString()
  gameId!: string;

  @Matches(SQUARE, { message: 'from must be a square like e2' })
  from!: string;

  @Matches(SQUARE, { message: 'to must be a square like e4' })
  to!: string;

  @IsOptional()
  @IsIn(['q', 'r', 'b', 'n'])
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export class GameIdDto {
  @IsString()
  gameId!: string;
}

export class ChatDto {
  @IsString()
  gameId!: string;

  @IsString()
  text!: string;
}

export class RejoinGameDto {
  @IsString()
  gameId!: string;

  @IsString()
  token!: string;
}
