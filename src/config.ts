import "dotenv/config";

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o-mini",

  // Conversation history limit per user (human + AI message pairs)
  maxHistory: 5,
};
