import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_SUB_CLIENT } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq } from 'drizzle-orm';

@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_SUB_CLIENT) private readonly redisSub: Redis,
    private readonly redisService: RedisService,
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  onModuleInit() {
    this.redisSub.subscribe('chat', (err) => {
      if (err) console.error('Redis subscribe error', err);
    });

    this.redisSub.on('message', (_channel, rawMessage) => {
      try {
        const event = JSON.parse(rawMessage);

        if (event.type === 'message:new') {
          const { roomId, message } = event;
          this.server.to(roomId).emit('message:new', {
            id: message.id,
            username: message.username,
            content: message.content,
            createdAt: message.createdAt,
          });
        }

        if (event.type === 'room:deleted') {
          const { roomId } = event;
          this.server.to(roomId).emit('room:deleted', { roomId });
        }
      } catch {
        // ignore malformed messages
      }
    });
  }

  async handleConnection(client: Socket) {
    const token = client.handshake.query.token as string;
    const roomId = client.handshake.query.roomId as string;

    if (!token) {
      client.emit('error', { code: 401, message: 'Missing or expired session token' });
      client.disconnect();
      return;
    }

    const userId = await this.redisService.getSession(token);
    if (!userId) {
      client.emit('error', { code: 401, message: 'Missing or expired session token' });
      client.disconnect();
      return;
    }

    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    if (!user) {
      client.emit('error', { code: 401, message: 'Missing or expired session token' });
      client.disconnect();
      return;
    }

    if (!roomId) {
      client.emit('error', { code: 404, message: 'Room not found' });
      client.disconnect();
      return;
    }

    const [room] = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId));

    if (!room) {
      client.emit('error', { code: 404, message: `Room with id ${roomId} does not exist` });
      client.disconnect();
      return;
    }

    // Store socket state in Redis
    await this.redisService.setSocketUser(client.id, user.username);
    await this.redisService.setSocketRoom(client.id, roomId);
    await this.redisService.addUserToRoom(roomId, user.username);

    client.join(roomId);

    const activeUsers = await this.redisService.getRoomUsers(roomId);

    // Emit to connecting client only
    client.emit('room:joined', { activeUsers });

    // Broadcast to everyone else in the room
    client.to(roomId).emit('room:user_joined', {
      username: user.username,
      activeUsers,
    });
  }

  async handleDisconnect(client: Socket) {
    await this.cleanupSocket(client);
  }

  @SubscribeMessage('room:leave')
  async handleLeave(@ConnectedSocket() client: Socket) {
    await this.cleanupSocket(client);
    client.disconnect();
  }

  private async cleanupSocket(client: Socket) {
    const username = await this.redisService.getSocketUser(client.id);
    const roomId = await this.redisService.getSocketRoom(client.id);

    if (!username || !roomId) return;

    await this.redisService.removeUserFromRoom(roomId, username);
    await this.redisService.deleteSocketUser(client.id);
    await this.redisService.deleteSocketRoom(client.id);

    const activeUsers = await this.redisService.getRoomUsers(roomId);

    this.server.to(roomId).emit('room:user_left', { username, activeUsers });
  }
}
