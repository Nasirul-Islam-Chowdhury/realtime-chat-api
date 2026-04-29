import { IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SendMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'Message content must not be empty' })
  @MaxLength(1000, { message: 'Message content must not exceed 1000 characters' })
  content: string;
}
