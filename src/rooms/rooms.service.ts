import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, lt, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import * as schema from '../database/schema';
import { DRIZZLE } from '../database/database.module';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RoomsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  async findAll() {
    const rooms = await this.db.select().from(schema.rooms);
    return Promise.all(
      rooms.map(async (room) => ({
        id: room.id,
        name: room.name,
        createdBy: room.createdBy,
        activeUsers: await this.redisService.getRoomUserCount(room.id),
        createdAt: room.createdAt,
      })),
    );
  }

  async create(name: string, username: string) {
    const existing = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.name, name));

    if (existing.length > 0) {
      throw new HttpException(
        { code: 'ROOM_NAME_TAKEN', message: 'A room with this name already exists' },
        HttpStatus.CONFLICT,
      );
    }

    const id = `room_${nanoid(6)}`;
    const [room] = await this.db
      .insert(schema.rooms)
      .values({ id, name, createdBy: username })
      .returning();

    return {
      id: room.id,
      name: room.name,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
    };
  }

  async findOne(id: string) {
    const [room] = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, id));

    if (!room) {
      throw new HttpException(
        { code: 'ROOM_NOT_FOUND', message: `Room with id ${id} does not exist` },
        HttpStatus.NOT_FOUND,
      );
    }

    const activeUsers = await this.redisService.getRoomUserCount(id);
    return { id: room.id, name: room.name, createdBy: room.createdBy, activeUsers, createdAt: room.createdAt };
  }

  async remove(id: string, username: string): Promise<void> {
    const [room] = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, id));

    if (!room) {
      throw new HttpException(
        { code: 'ROOM_NOT_FOUND', message: `Room with id ${id} does not exist` },
        HttpStatus.NOT_FOUND,
      );
    }

    if (room.createdBy !== username) {
      throw new HttpException(
        { code: 'FORBIDDEN', message: 'Only the room creator can delete this room' },
        HttpStatus.FORBIDDEN,
      );
    }

    // Publish room:deleted event before deleting
    await this.redisService.publish(
      'chat',
      JSON.stringify({ type: 'room:deleted', roomId: id }),
    );

    await this.db.delete(schema.rooms).where(eq(schema.rooms.id, id));
    await this.redisService.deleteRoomUsers(id);
  }

  async getMessages(roomId: string, limit: number, before?: string) {
    const [room] = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId));

    if (!room) {
      throw new HttpException(
        { code: 'ROOM_NOT_FOUND', message: `Room with id ${roomId} does not exist` },
        HttpStatus.NOT_FOUND,
      );
    }

    const clampedLimit = Math.min(limit || 50, 100);

    let query = this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.roomId, roomId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(clampedLimit + 1) as any;

    if (before) {
      const [cursorMsg] = await this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, before));

      if (cursorMsg) {
        query = this.db
          .select()
          .from(schema.messages)
          .where(
            eq(schema.messages.roomId, roomId),
          )
          .orderBy(desc(schema.messages.createdAt))
          .limit(clampedLimit + 1) as any;

        // Filter messages older than cursor using raw fetch then slice
        const all = await this.db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.roomId, roomId))
          .orderBy(desc(schema.messages.createdAt));

        const cursorIndex = all.findIndex((m) => m.id === before);
        const sliced = cursorIndex >= 0 ? all.slice(cursorIndex + 1, cursorIndex + 1 + clampedLimit + 1) : [];
        const hasMore = sliced.length > clampedLimit;
        const messages = sliced.slice(0, clampedLimit);
        return {
          messages: messages.map((m) => ({
            id: m.id,
            roomId: m.roomId,
            username: m.username,
            content: m.content,
            createdAt: m.createdAt,
          })),
          hasMore,
          nextCursor: hasMore ? messages[messages.length - 1]?.id ?? null : null,
        };
      }
    }

    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.roomId, roomId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(clampedLimit + 1);

    const hasMore = rows.length > clampedLimit;
    const messages = rows.slice(0, clampedLimit);

    return {
      messages: messages.map((m) => ({
        id: m.id,
        roomId: m.roomId,
        username: m.username,
        content: m.content,
        createdAt: m.createdAt,
      })),
      hasMore,
      nextCursor: hasMore ? messages[messages.length - 1]?.id ?? null : null,
    };
  }

  async sendMessage(roomId: string, username: string, content: string) {
    const [room] = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId));

    if (!room) {
      throw new HttpException(
        { code: 'ROOM_NOT_FOUND', message: `Room with id ${roomId} does not exist` },
        HttpStatus.NOT_FOUND,
      );
    }

    const trimmed = content.trim();
    if (!trimmed) {
      throw new HttpException(
        { code: 'MESSAGE_EMPTY', message: 'Message content must not be empty' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (trimmed.length > 1000) {
      throw new HttpException(
        { code: 'MESSAGE_TOO_LONG', message: 'Message content must not exceed 1000 characters' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const id = `msg_${nanoid(6)}`;
    const [message] = await this.db
      .insert(schema.messages)
      .values({ id, roomId, username, content: trimmed })
      .returning();

    const payload = {
      id: message.id,
      roomId: message.roomId,
      username: message.username,
      content: message.content,
      createdAt: message.createdAt,
    };

    // Publish to Redis for WebSocket fan-out
    await this.redisService.publish(
      'chat',
      JSON.stringify({ type: 'message:new', roomId, message: payload }),
    );

    return payload;
  }
}
