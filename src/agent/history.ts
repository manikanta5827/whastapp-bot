import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { config } from "../config.ts";

const userHistories = new Map<string, ChatCompletionMessageParam[]>();

export function getHistory(userId: string): ChatCompletionMessageParam[] {
  if (!userHistories.has(userId)) {
    userHistories.set(userId, []);
  }
  return userHistories.get(userId)!;
}

export function updateHistory(
  userId: string,
  humanText: string,
  aiText: string,
): void {
  const history = getHistory(userId);
  history.push(
    { role: "user", content: humanText },
    { role: "assistant", content: aiText },
  );

  if (history.length > config.maxHistory) {
    history.splice(0, history.length - config.maxHistory);
  }
}
