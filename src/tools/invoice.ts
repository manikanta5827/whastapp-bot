import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { and, eq, between, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { users, customers, purchases, payments } from "../db/schema.ts";
import {
  createInvoice,
  type SellerInfo,
  type CustomerInfo,
} from "../invoice/generator.ts";
import { formatInvoiceForWhatsApp } from "../invoice/formatter.ts";
import { generateInvoicePdf } from "../invoice/pdf.ts";
import { generateReportPdf, type CustomerReport } from "../invoice/report.ts";
import { storePdf } from "../invoice/pdfStore.ts";
import { storePending, retrievePending } from "../invoice/pendingStore.ts";
import logger from "../logger.ts";

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
    logger.info("create_invoice called", { userId: input.userId, customerId: input.customerId, itemCount: input.items.length });
    const seller = getSellerInfo(input.userId);
    const customer = getCustomerInfo(input.userId, input.customerId);
    if (!customer)
      return "Customer not found. Please search for the customer first.";

    const invoice = createInvoice(seller, customer, input.items, input.date);
    storePending(invoice.invoiceNumber, {
      ...invoice,
      _customerId: input.customerId,
      _date: input.date || new Date().toISOString().slice(0, 10),
    } as any);
    logger.info("Invoice preview created", { invoiceNumber: invoice.invoiceNumber, customerId: input.customerId, total: invoice.total, date: input.date });

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
      date: z
        .string()
        .optional()
        .describe("Sale date YYYY-MM-DD. Use if user specifies a date (e.g. 'yesterday', 'last Monday'). Defaults to today."),
    }),
  },
);

export const confirmInvoiceTool = tool(
  async (input) => {
    logger.info("confirm_invoice called", { userId: input.userId, invoiceNumber: input.invoiceNumber });
    const pending = retrievePending(input.invoiceNumber) as any;
    if (!pending) {
      logger.warn("Invoice not found or already confirmed", { invoiceNumber: input.invoiceNumber });
      return `Invoice ${input.invoiceNumber} not found or already confirmed.`;
    }

    const { _customerId, _date, ...invoice } = pending;

    // Generate PDF first — if this fails, don't save the purchase
    const pdfBuffer = await generateInvoicePdf(invoice);

    // Record purchase in DB — use the date from when the invoice was created
    const purchaseDate = _date || new Date().toISOString().slice(0, 10);
    db.insert(purchases)
      .values({
        invoiceNumber: invoice.invoiceNumber,
        userId: input.userId,
        customerId: _customerId,
        items: JSON.stringify(invoice.items),
        subtotal: invoice.subtotal,
        totalGst: invoice.totalGst,
        total: invoice.total,
        date: purchaseDate,
      })
      .run();

    // Store PDF for WhatsApp sender to pick up
    storePdf(invoice.invoiceNumber, pdfBuffer);
    logger.info("Invoice confirmed and PDF generated", { invoiceNumber: invoice.invoiceNumber, total: invoice.total, pdfSize: pdfBuffer.length });

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

export const generateReportTool = tool(
  async (input) => {
    logger.info("generate_report called", { userId: input.userId, fromDate: input.fromDate, toDate: input.toDate, customerIds: input.customerIds });
    const seller = getSellerInfo(input.userId);

    // Determine which customers to include
    let customerRows;
    if (input.customerIds?.length) {
      customerRows = db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.userId, input.userId),
            inArray(customers.id, input.customerIds),
          ),
        )
        .all();
    } else {
      // All customers who have sales OR payments in the date range
      const salesCustomerIds = db
        .select({ id: purchases.customerId })
        .from(purchases)
        .where(
          and(
            eq(purchases.userId, input.userId),
            between(purchases.date, input.fromDate, input.toDate),
          ),
        )
        .all()
        .map((r) => r.id);

      const paymentCustomerIds = db
        .select({ id: payments.customerId })
        .from(payments)
        .where(
          and(
            eq(payments.userId, input.userId),
            between(payments.date, input.fromDate, input.toDate),
          ),
        )
        .all()
        .map((r) => r.id);

      const uniqueIds = [...new Set([...salesCustomerIds, ...paymentCustomerIds])];
      if (uniqueIds.length === 0) {
        return "No sales or payments found for the given period.";
      }

      customerRows = db
        .select()
        .from(customers)
        .where(inArray(customers.id, uniqueIds))
        .all();
    }

    if (customerRows.length === 0) {
      return "No customers found.";
    }

    // Build report for each customer
    const customerReports: CustomerReport[] = [];

    for (const c of customerRows) {
      // Opening balance = initial + sales before fromDate - payments before fromDate
      const salesBefore = db
        .select({ total: sql<number>`COALESCE(SUM(${purchases.total}), 0)` })
        .from(purchases)
        .where(and(eq(purchases.customerId, c.id), lt(purchases.date, input.fromDate)))
        .get()!.total;

      const paymentsBefore = db
        .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
        .from(payments)
        .where(and(eq(payments.customerId, c.id), lt(payments.date, input.fromDate)))
        .get()!.total;

      const openingBalance = c.initialBalance + salesBefore - paymentsBefore;

      // Sales in range
      const salesInRange = db
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.customerId, c.id),
            between(purchases.date, input.fromDate, input.toDate),
          ),
        )
        .all();

      const totalSales = salesInRange.reduce((sum, s) => sum + s.total, 0);

      // Payments in range
      const paymentsInRange = db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.customerId, c.id),
            between(payments.date, input.fromDate, input.toDate),
          ),
        )
        .all();

      const totalPayments = paymentsInRange.reduce((sum, p) => sum + p.amount, 0);

      const closingBalance = openingBalance + totalSales - totalPayments;

      customerReports.push({
        customerName: c.name,
        customerPhone: c.phone || undefined,
        customerCity: c.city || undefined,
        openingBalance,
        sales: salesInRange.map((s) => ({
          invoiceNumber: s.invoiceNumber,
          date: s.date,
          items: JSON.parse(s.items),
          total: s.total,
        })),
        payments: paymentsInRange.map((p) => ({
          date: p.date,
          amount: p.amount,
          mode: p.mode,
          note: p.note,
        })),
        totalSales,
        totalPayments,
        closingBalance,
      });
    }

    const reportId = `REPORT-${input.fromDate}-to-${input.toDate}`;
    const pdfBuffer = await generateReportPdf({
      sellerName: seller.name,
      sellerAddress: seller.address,
      sellerGstin: seller.gstin,
      sellerPhone: seller.phone,
      fromDate: input.fromDate,
      toDate: input.toDate,
      customers: customerReports,
    });

    storePdf(reportId, pdfBuffer);
    logger.info("Report PDF generated", { reportId, customerCount: customerReports.length, pdfSize: pdfBuffer.length });

    const summaryLines = customerReports.map(
      (c) => `• ${c.customerName}: Sales ₹${c.totalSales.toFixed(2)}, Payments ₹${c.totalPayments.toFixed(2)}, Balance ₹${c.closingBalance.toFixed(2)}${c.closingBalance > 0 ? " (owes)" : c.closingBalance < 0 ? " (advance)" : " (settled)"}`,
    );

    return `Report generated (${input.fromDate} to ${input.toDate}), ${customerReports.length} customer(s):\n${summaryLines.join("\n")}\n\nReport: ${reportId}`;
  },
  {
    name: "generate_report",
    description: `Generate an account statement PDF with sales, payments, and balance for a date range.
Shows per-customer: opening balance, sales list, payments list, closing balance.

BEFORE calling, if user mentions specific customer names:
1. Call search_customers for each name
2. If multiple matches, ask user to pick
3. Collect resolved customer IDs

If no customer names mentioned (e.g. "send report for today"), pass no customerIds — includes all customers with activity in the range.
No confirmation needed.`,
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
