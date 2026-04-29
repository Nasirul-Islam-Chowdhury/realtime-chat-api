import { IsString, Matches, MinLength, MaxLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @MinLength(3, { message: 'name must be between 3 and 32 characters' })
  @MaxLength(32, { message: 'name must be between 3 and 32 characters' })
  @Matches(/^[a-zA-Z0-9-]+$/, { message: 'name must contain only alphanumeric characters and hyphens' })
  name: string;
}
