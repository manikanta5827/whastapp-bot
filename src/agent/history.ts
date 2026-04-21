import {
  HumanMessage,
  AIMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { and, eq, desc, lt } from "drizzle-orm";
import { db } from "../db/index.ts";
import { messages } from "../db/schema.ts";
import { config } from "../config.ts";

export function getHistory(userId: string): BaseMessage[] {
  const rows = db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.id))
    .limit(config.maxHistory)
    .all();

  return rows.reverse().map((row) =>
    row.role === "human"
      ? new HumanMessage(row.content)
      : new AIMessage(row.content),
  );
}

export function updateHistory(
  userId: string,
  humanText: string,
  aiText: string,
): void {
  db.insert(messages)
    .values([
      { userId, role: "human" as const, content: humanText },
      { userId, role: "ai" as const, content: aiText },
    ])
    .run();

  // Trim: find the Nth newest message's id, delete everything older
  const cutoff = db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.id))
    .limit(1)
    .offset(config.maxHistory - 1)
    .all();

  if (cutoff.length > 0) {
    db.delete(messages)
      .where(and(eq(messages.userId, userId), lt(messages.id, cutoff[0].id)))
      .run();
  }
}
