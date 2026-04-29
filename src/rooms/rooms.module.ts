import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { RedisService } from '../redis/redis.service';
import { AuthGuard } from '../common/guards/auth.guard';

@Module({
  controllers: [RoomsController],
  providers: [RoomsService, RedisService, AuthGuard],
  exports: [RoomsService],
})
export class RoomsModule {}
