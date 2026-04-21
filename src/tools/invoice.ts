import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { and, eq, between, inArray } from "drizzle-orm";
import { db } from "../db/index.ts";
import { users, customers, purchases } from "../db/schema.ts";
import {
  createInvoice,
  type SellerInfo,
  type CustomerInfo,
} from "../invoice/generator.ts";
import { formatInvoiceForWhatsApp } from "../invoice/formatter.ts";
import { generateInvoicePdf } from "../invoice/pdf.ts";
import { storePdf } from "../invoice/pdfStore.ts";
import { storePending, retrievePending } from "../invoice/pendingStore.ts";

const invoiceItemSchema = z.object({
  description: z
    .string()
    .describe('Item or service description, e.g. "Tomatoes", "Consultancy"'),
  quantity: z.number().describe("Quantity of the item"),
  unit: z
    .string()
    .describe('Unit of measurement, e.g. "hrs", "kg", "pcs", "nos"'),
  rate: z.number().describe("Price per unit in rupees"),
  gstPercent: z
    .number()
    .default(0)
    .describe("GST percentage: 0, 5, 12, 18, or 28"),
});

function getSellerInfo(userId: number): SellerInfo {
  const user = db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .get()!;

  return {
    name: user.businessName!,
    address: user.address || "",
    gstin: user.gstin || "",
    phone: user.businessPhone!,
  };
}

function getCustomerInfo(
  userId: number,
  customerId: number,
): CustomerInfo | null {
  const c = db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.userId, userId)))
    .get();

  if (!c) return null;
  return {
    name: c.name,
    phone: c.phone || undefined,
    address: c.address || undefined,
    gstin: c.gstin || undefined,
  };
}

export const createInvoiceTool = tool(
  async (input) => {
    const seller = getSellerInfo(input.userId);
    const customer = getCustomerInfo(input.userId, input.customerId);
    if (!customer)
      return "Customer not found. Please search for the customer first.";

    const invoice = createInvoice(seller, customer, input.items);
    storePending(invoice.invoiceNumber, {
      ...invoice,
      _customerId: input.customerId,
    } as any);

    const formatted = formatInvoiceForWhatsApp(invoice);
    return `Here is the sale preview:\n\n${formatted}\n\nConfirm to record this sale? *Yes* / *No*\nInvoice: ${invoice.invoiceNumber}`;
  },
  {
    name: "create_invoice",
    description: `Create a sale preview for confirmation. BEFORE calling this, you MUST:
1. Search for the customer using search_customers
2. If multiple matches, ask user to pick
3. If no match, create customer first
4. Then call this with the customer ID

This creates a PREVIEW only. The sale is recorded in DB after user confirms. NO PDF is generated here.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      customerId: z.number().describe("Customer ID from search results"),
      items: z
        .array(invoiceItemSchema)
        .describe("List of items/services for the invoice"),
    }),
  },
);

export const confirmInvoiceTool = tool(
  async (input) => {
    const pending = retrievePending(input.invoiceNumber) as any;
    if (!pending)
      return `Invoice ${input.invoiceNumber} not found or already confirmed.`;

    const { _customerId, ...invoice } = pending;

    // Generate PDF first — if this fails, don't save the purchase
    const pdfBuffer = await generateInvoicePdf(invoice);

    // Record purchase in DB
    const today = new Date().toISOString().slice(0, 10);
    db.insert(purchases)
      .values({
        invoiceNumber: invoice.invoiceNumber,
        userId: input.userId,
        customerId: _customerId,
        items: JSON.stringify(invoice.items),
        subtotal: invoice.subtotal,
        totalGst: invoice.totalGst,
        total: invoice.total,
        date: today,
      })
      .run();

    // Store PDF for WhatsApp sender to pick up
    storePdf(invoice.invoiceNumber, pdfBuffer);

    return `Sale recorded and invoice PDF generated! ${invoice.invoiceNumber} — ${invoice.customerName}, ₹${invoice.total.toFixed(2)}.`;
  },
  {
    name: "confirm_invoice",
    description: `Confirm a pending sale — records it in the database AND generates the invoice PDF immediately. Call this when the user says "yes", "confirm", "ok" after seeing a preview.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      invoiceNumber: z
        .string()
        .describe("The invoice number to confirm, e.g. INV-20260421-001"),
    }),
  },
);

export const generateInvoicePdfsTool = tool(
  async (input) => {
    const seller = getSellerInfo(input.userId);

    const rows = db
      .select({
        invoiceNumber: purchases.invoiceNumber,
        customerName: customers.name,
        customerPhone: customers.phone,
        customerAddress: customers.address,
        customerGstin: customers.gstin,
        items: purchases.items,
        subtotal: purchases.subtotal,
        totalGst: purchases.totalGst,
        total: purchases.total,
        date: purchases.date,
      })
      .from(purchases)
      .innerJoin(customers, eq(purchases.customerId, customers.id))
      .where(
        and(
          eq(purchases.userId, input.userId),
          between(purchases.date, input.fromDate, input.toDate),
          ...(input.customerIds?.length
            ? [inArray(purchases.customerId, input.customerIds)]
            : []),
        ),
      )
      .all();

    if (rows.length === 0) {
      return "No sales found for the given period.";
    }

    const invoiceNumbers: string[] = [];
    for (const row of rows) {
      const invoice = {
        invoiceNumber: row.invoiceNumber,
        date: row.date,
        customerName: row.customerName,
        customerPhone: row.customerPhone || undefined,
        customerAddress: row.customerAddress || undefined,
        customerGstin: row.customerGstin || undefined,
        sellerName: seller.name,
        sellerAddress: seller.address,
        sellerGstin: seller.gstin,
        sellerPhone: seller.phone,
        items: JSON.parse(row.items),
        subtotal: row.subtotal,
        totalGst: row.totalGst,
        total: row.total,
      };

      const pdfBuffer = await generateInvoicePdf(invoice);
      storePdf(row.invoiceNumber, pdfBuffer);
      invoiceNumbers.push(row.invoiceNumber);
    }

    return `Generated ${invoiceNumbers.length} invoice PDF${invoiceNumbers.length > 1 ? "s" : ""}. Invoice numbers: ${invoiceNumbers.join(", ")}`;
  },
  {
    name: "generate_invoice_pdfs",
    description: `Generate and send invoice PDFs for recorded sales in a date range. Optionally filter by customer IDs.
BEFORE calling this, if the user mentions specific customer names:
1. Call search_customers for each name
2. If multiple matches for a name, ask user to pick
3. If no match, tell user that customer was not found
4. Collect the resolved customer IDs, then call this tool

If no customer names mentioned (e.g. "send all invoices for today"), pass no customerIds to get ALL sales in the date range.
No confirmation needed — these are already-confirmed sales.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      fromDate: z.string().describe("Start date YYYY-MM-DD"),
      toDate: z.string().describe("End date YYYY-MM-DD"),
      customerIds: z
        .array(z.number())
        .optional()
        .describe("Filter by specific customer IDs (resolved via search_customers)"),
    }),
  },
);
