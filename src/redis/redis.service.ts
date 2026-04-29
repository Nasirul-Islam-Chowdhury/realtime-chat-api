import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.module';

const SESSION_TTL = 60 * 60 * 24; // 24 hours in seconds
const SESSION_PREFIX = 'session:';
const ROOM_USERS_PREFIX = 'room:users:';
const SOCKET_USER_PREFIX = 'socket:user:';
const SOCKET_ROOM_PREFIX = 'socket:room:';

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // Sessions
  async setSession(token: string, userId: string): Promise<void> {
    await this.redis.setex(`${SESSION_PREFIX}${token}`, SESSION_TTL, userId);
  }

  async getSession(token: string): Promise<string | null> {
    return this.redis.get(`${SESSION_PREFIX}${token}`);
  }

  async deleteSession(token: string): Promise<void> {
    await this.redis.del(`${SESSION_PREFIX}${token}`);
  }

  // Active users per room (stored as set of usernames)
  async addUserToRoom(roomId: string, username: string): Promise<void> {
    await this.redis.sadd(`${ROOM_USERS_PREFIX}${roomId}`, username);
  }

  async removeUserFromRoom(roomId: string, username: string): Promise<void> {
    await this.redis.srem(`${ROOM_USERS_PREFIX}${roomId}`, username);
  }

  async getRoomUsers(roomId: string): Promise<string[]> {
    return this.redis.smembers(`${ROOM_USERS_PREFIX}${roomId}`);
  }

  async getRoomUserCount(roomId: string): Promise<number> {
    return this.redis.scard(`${ROOM_USERS_PREFIX}${roomId}`);
  }

  async deleteRoomUsers(roomId: string): Promise<void> {
    await this.redis.del(`${ROOM_USERS_PREFIX}${roomId}`);
  }

  // Socket connection state
  async setSocketUser(socketId: string, username: string): Promise<void> {
    await this.redis.set(`${SOCKET_USER_PREFIX}${socketId}`, username);
  }

  async getSocketUser(socketId: string): Promise<string | null> {
    return this.redis.get(`${SOCKET_USER_PREFIX}${socketId}`);
  }

  async deleteSocketUser(socketId: string): Promise<void> {
    await this.redis.del(`${SOCKET_USER_PREFIX}${socketId}`);
  }

  async setSocketRoom(socketId: string, roomId: string): Promise<void> {
    await this.redis.set(`${SOCKET_ROOM_PREFIX}${socketId}`, roomId);
  }

  async getSocketRoom(socketId: string): Promise<string | null> {
    return this.redis.get(`${SOCKET_ROOM_PREFIX}${socketId}`);
  }

  async deleteSocketRoom(socketId: string): Promise<void> {
    await this.redis.del(`${SOCKET_ROOM_PREFIX}${socketId}`);
  }

  // Pub/sub publishing
  async publish(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message);
  }
}
