import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { RedisService } from '../../redis/redis.service';
import { DRIZZLE } from '../../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly redisService: RedisService,
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new HttpException(
        { code: 'UNAUTHORIZED', message: 'Missing or expired session token' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = authHeader.slice(7);
    const userId = await this.redisService.getSession(token);

    if (!userId) {
      throw new HttpException(
        { code: 'UNAUTHORIZED', message: 'Missing or expired session token' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    if (!user) {
      throw new HttpException(
        { code: 'UNAUTHORIZED', message: 'Missing or expired session token' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    (request as any).user = user;
    return true;
  }
}
