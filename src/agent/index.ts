import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { config } from "../config.ts";
import { getHistory, updateHistory } from "./history.ts";
import {
  createInvoiceDefinition,
  executeCreateInvoice,
} from "../tools/invoice.ts";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const SYSTEM_PROMPT: ChatCompletionMessageParam = {
  role: "system",
  content: `You are a helpful WhatsApp invoice assistant for Indian businesses.
Your primary job is to help users create invoices for their customers.

When a user asks to create an invoice or bill someone:
1. Extract the customer name, items, quantities, units, rates, and GST from their message.
2. Call the create_invoice tool with the extracted data.
3. Return the formatted invoice to the user.

For quantities, infer sensible units: "1 hour" → unit "hrs", "50 kg" → unit "kg", "10 pieces" → unit "pcs".
If no unit is specified, use "nos" (numbers).
If GST is mentioned globally (e.g. "5% GST on all"), apply it to every item.
If GST is not mentioned, use 0%.

Be concise — responses are read on a phone.
If the user asks something unrelated to invoices, help them briefly but guide them back to invoice creation.`,
};

const tools = [createInvoiceDefinition];

const toolExecutors: Record<string, (args: any) => string> = {
  create_invoice: executeCreateInvoice,
};

export async function processMessage(
  userId: string,
  text: string,
): Promise<string> {
  const history = getHistory(userId);
  const messages: ChatCompletionMessageParam[] = [
    SYSTEM_PROMPT,
    ...history,
    { role: "user", content: text },
  ];

  // Tool-call loop: keep calling until we get a text response
  while (true) {
    const response = await openai.chat.completions.create({
      model: config.model,
      messages,
      tools,
    });

    const choice = response.choices[0];
    const message = choice.message;

    // No tool calls — we have our final text response
    if (!message.tool_calls?.length) {
      const responseText =
        message.content ?? "Sorry, I could not generate a response.";
      updateHistory(userId, text, responseText);
      return responseText;
    }

    // Add assistant message with tool calls to context
    messages.push(message);

    // Execute each tool call and add results
    for (const toolCall of message.tool_calls) {
      const executor = toolExecutors[toolCall.function.name];
      let result: string;

      if (executor) {
        const args = JSON.parse(toolCall.function.arguments);
        result = executor(args);
      } else {
        result = `Unknown tool: ${toolCall.function.name}`;
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }
}
