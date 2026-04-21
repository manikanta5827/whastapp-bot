import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

const sqlite = new Database("bot.db");
export const db = drizzle({ client: sqlite, schema });

// Run migrations on startup
migrate(db, { migrationsFolder: "./drizzle" });
