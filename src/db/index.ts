import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);

// 🔥 سكريبت إنشاء الجداول تلقائياً فـ Supabase
(async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        about TEXT NOT NULL DEFAULT '',
        avatar_url TEXT,
        public_key TEXT NOT NULL,
        private_key_enc TEXT NOT NULL,
        kek_salt TEXT NOT NULL,
        kek_iv TEXT NOT NULL,
        theme TEXT NOT NULL DEFAULT 'dark',
        is_online BOOLEAN NOT NULL DEFAULT false,
        last_seen_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    console.log("✅ Database Tables migrated successfully!");
  } catch (e) {
    console.error("❌ Auto-migration failed:", e);
  }
})();
