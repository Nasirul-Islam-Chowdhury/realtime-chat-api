import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import * as schema from '../database/schema';
import { DRIZZLE } from '../database/database.module';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  async login(username: string): Promise<{ sessionToken: string; user: schema.User }> {
    let [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username));

    if (!user) {
      const id = `usr_${nanoid(8)}`;
      [user] = await this.db
        .insert(schema.users)
        .values({ id, username })
        .returning();
    }

    const sessionToken = nanoid(32);
    await this.redisService.setSession(sessionToken, user.id);

    return { sessionToken, user };
  }
}
