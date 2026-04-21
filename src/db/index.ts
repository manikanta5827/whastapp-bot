import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";
import logger from "../logger.ts";

const sqlite = new Database("bot.db");
sqlite.pragma("foreign_keys = ON");
export const db = drizzle({ client: sqlite, schema });

// Run migrations on startup
logger.info("Running database migrations...");
migrate(db, { migrationsFolder: "./drizzle" });
logger.info("Database ready");
