import {
  HumanMessage,
  AIMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { config } from "../config.ts";

const userHistories = new Map<string, BaseMessage[]>();

export function getHistory(userId: string): BaseMessage[] {
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
  history.push(new HumanMessage(humanText), new AIMessage(aiText));

  if (history.length > config.maxHistory) {
    history.splice(0, history.length - config.maxHistory);
  }
}
