import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RedisService } from '../redis/redis.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, RedisService],
  exports: [RedisService],
})
export class AuthModule {}
