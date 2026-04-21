import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createInvoice } from "../invoice/generator.ts";
import { formatInvoiceForWhatsApp } from "../invoice/formatter.ts";
import { generateInvoicePdf } from "../invoice/pdf.ts";
import { storePdf } from "../invoice/pdfStore.ts";

const invoiceItemSchema = z.object({
  description: z
    .string()
    .describe('Item or service description, e.g. "CA Consultancy", "Tomatoes"'),
  quantity: z.number().describe("Quantity of the item"),
  unit: z
    .string()
    .describe('Unit of measurement, e.g. "hrs", "kg", "pcs", "nos"'),
  rate: z.number().describe("Price per unit in rupees"),
  gstPercent: z
    .number()
    .default(0)
    .describe(
      "GST percentage for this item, e.g. 5, 12, 18, 28. Use 0 if not specified.",
    ),
});

export const createInvoiceTool = tool(
  async (input) => {
    const invoice = createInvoice(
      input.customerName,
      input.items,
      input.customerPhone,
    );

    const pdfBuffer = await generateInvoicePdf(invoice);
    storePdf(invoice.invoiceNumber, pdfBuffer);

    const formatted = formatInvoiceForWhatsApp(invoice);

    return `Invoice ${invoice.invoiceNumber} created successfully!\n\n${formatted}`;
  },
  {
    name: "create_invoice",
    description: `Create a GST invoice for a customer. Use this when the user wants to bill someone or create an invoice.
Extract the customer name, line items (description, quantity, unit, rate), and GST percentage from the user's message.
If GST is mentioned for all items, apply it to each. If no GST is mentioned, use 0.
Common Indian GST rates: 5%, 12%, 18%, 28%.`,
    schema: z.object({
      customerName: z.string().describe("Name of the customer being billed"),
      customerPhone: z
        .string()
        .optional()
        .describe("Customer phone number if provided"),
      items: z
        .array(invoiceItemSchema)
        .describe("List of items/services to include in the invoice"),
    }),
  },
);
