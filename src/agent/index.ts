import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { config } from "../config.ts";
import { getHistory, updateHistory } from "./history.ts";
import { createInvoiceTool } from "../tools/invoice.ts";

const llm = new ChatOpenAI({
  model: config.model,
  apiKey: config.openaiApiKey,
});

const tools = [createInvoiceTool];

const agent = createReactAgent({
  llm,
  tools,
  stateModifier: new SystemMessage(
    `You are a helpful WhatsApp invoice assistant for Indian businesses.
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
  ),
});

export async function processMessage(
  userId: string,
  text: string,
): Promise<string> {
  const history = getHistory(userId);

  const result = await agent.invoke({
    messages: [...history, new HumanMessage(text)],
  });

  const aiMessages = result.messages.filter(
    (m: any) => m._getType() === "ai" && !m.tool_calls?.length,
  );
  const lastAI = aiMessages.at(-1);
  const responseText =
    typeof lastAI?.content === "string"
      ? lastAI.content
      : ((lastAI?.content as any[])?.find((c: any) => c.type === "text")
          ?.text ?? "Sorry, I could not generate a response.");

  updateHistory(userId, text, responseText);
  return responseText;
}
