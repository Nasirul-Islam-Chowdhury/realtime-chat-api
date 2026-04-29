import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { RedisService } from '../redis/redis.service';

@Module({
  providers: [ChatGateway, RedisService],
})
export class ChatModule {}
