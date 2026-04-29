import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { sql } from 'drizzle-orm';

dotenv.config();

async function migrate() {
  const dbUrl = process.env.DATABASE_URL!;

  // Connect to postgres default DB to ensure target DB exists
  const adminUrl = dbUrl.replace(/\/[^/]+$/, '/postgres');
  const dbName = dbUrl.match(/\/([^/?]+)(\?|$)/)?.[1];
  const adminPool = new Pool({ connectionString: adminUrl });
  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
  } catch (e: any) {
    if (e.code !== '42P04') throw e; // 42P04 = database already exists
  }
  await adminPool.end();

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(username),
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      username TEXT NOT NULL REFERENCES users(username),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);

  console.log('Migration complete');
  await pool.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
