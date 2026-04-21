import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { createInvoice } from "../invoice/generator.ts";
import { formatInvoiceForWhatsApp } from "../invoice/formatter.ts";

export const createInvoiceDefinition: ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_invoice",
    description: `Create a GST invoice for a customer. Use this when the user wants to bill someone or create an invoice.
Extract the customer name, line items (description, quantity, unit, rate), and GST percentage from the user's message.
If GST is mentioned for all items, apply it to each. If no GST is mentioned, use 0.
Common Indian GST rates: 5%, 12%, 18%, 28%.`,
    parameters: {
      type: "object",
      required: ["customerName", "items"],
      properties: {
        customerName: {
          type: "string",
          description: "Name of the customer being billed",
        },
        customerPhone: {
          type: "string",
          description: "Customer phone number if provided",
        },
        items: {
          type: "array",
          description: "List of items/services to include in the invoice",
          items: {
            type: "object",
            required: ["description", "quantity", "unit", "rate"],
            properties: {
              description: {
                type: "string",
                description:
                  'Item or service description, e.g. "CA Consultancy", "Tomatoes"',
              },
              quantity: {
                type: "number",
                description: "Quantity of the item",
              },
              unit: {
                type: "string",
                description:
                  'Unit of measurement, e.g. "hrs", "kg", "pcs", "nos"',
              },
              rate: {
                type: "number",
                description: "Price per unit in rupees",
              },
              gstPercent: {
                type: "number",
                description:
                  "GST percentage for this item, e.g. 5, 12, 18, 28. Use 0 if not specified.",
                default: 0,
              },
            },
          },
        },
      },
    },
  },
};

interface CreateInvoiceInput {
  customerName: string;
  customerPhone?: string;
  items: {
    description: string;
    quantity: number;
    unit: string;
    rate: number;
    gstPercent?: number;
  }[];
}

export function executeCreateInvoice(args: CreateInvoiceInput): string {
  const items = args.items.map((item) => ({
    ...item,
    gstPercent: item.gstPercent ?? 0,
  }));

  const invoice = createInvoice(args.customerName, items, args.customerPhone);
  const formatted = formatInvoiceForWhatsApp(invoice);

  return `Invoice ${invoice.invoiceNumber} created successfully!\n\n${formatted}`;
}
