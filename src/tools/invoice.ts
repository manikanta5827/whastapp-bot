import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { and, eq, between, desc, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { users, customers, sales, payments } from "../db/schema.ts";
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
  const user = db.select().from(users).where(eq(users.id, userId)).get()!;

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
    logger.info("create_invoice called", {
      userId: input.userId,
      customerId: input.customerId,
      itemCount: input.items.length,
    });
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
    logger.info("Invoice preview created", {
      invoiceNumber: invoice.invoiceNumber,
      customerId: input.customerId,
      total: invoice.total,
      date: input.date,
    });

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
        .describe(
          "Sale date YYYY-MM-DD. Use if user specifies a date (e.g. 'yesterday', 'last Monday'). Defaults to today.",
        ),
    }),
  },
);

export const confirmInvoiceTool = tool(
  async (input) => {
    logger.info("confirm_invoice called", {
      userId: input.userId,
      invoiceNumber: input.invoiceNumber,
    });
    const pending = retrievePending(input.invoiceNumber) as any;
    if (!pending) {
      logger.warn("Invoice not found or already confirmed", {
        invoiceNumber: input.invoiceNumber,
      });
      return `Invoice ${input.invoiceNumber} not found or already confirmed.`;
    }

    const { _customerId, _date, ...invoice } = pending;

    // Generate PDF first — if this fails, don't save the sale
    const pdfBuffer = await generateInvoicePdf(invoice);

    // Record sale in DB — use the date from when the invoice was created
    const saleDate = _date || new Date().toISOString().slice(0, 10);
    db.insert(sales)
      .values({
        invoiceNumber: invoice.invoiceNumber,
        userId: input.userId,
        customerId: _customerId,
        items: JSON.stringify(invoice.items),
        subtotal: invoice.subtotal,
        totalGst: invoice.totalGst,
        total: invoice.total,
        date: saleDate,
      })
      .run();

    // Store PDF for WhatsApp sender to pick up
    storePdf(invoice.invoiceNumber, pdfBuffer, invoice.customerName);
    logger.info("Invoice confirmed and PDF generated", {
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      pdfSize: pdfBuffer.length,
    });

    return `Sale recorded and invoice PDF generated! ${invoice.invoiceNumber} — ${invoice.customerName}, ₹${invoice.total.toFixed(2)}. Forward the PDF to the customer.`;
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
    logger.info("generate_report called", {
      userId: input.userId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      customerIds: input.customerIds,
    });
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
        .select({ id: sales.customerId })
        .from(sales)
        .where(
          and(
            eq(sales.userId, input.userId),
            between(sales.date, input.fromDate, input.toDate),
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

      const uniqueIds = [
        ...new Set([...salesCustomerIds, ...paymentCustomerIds]),
      ];
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
        .select({ total: sql<number>`COALESCE(SUM(${sales.total}), 0)` })
        .from(sales)
        .where(and(eq(sales.customerId, c.id), lt(sales.date, input.fromDate)))
        .get()!.total;

      const paymentsBefore = db
        .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
        .from(payments)
        .where(
          and(eq(payments.customerId, c.id), lt(payments.date, input.fromDate)),
        )
        .get()!.total;

      const openingBalance = c.initialBalance + salesBefore - paymentsBefore;

      // Sales in range
      const salesInRange = db
        .select()
        .from(sales)
        .where(
          and(
            eq(sales.customerId, c.id),
            between(sales.date, input.fromDate, input.toDate),
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

      const totalPayments = paymentsInRange.reduce(
        (sum, p) => sum + p.amount,
        0,
      );

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
    logger.info("Report PDF generated", {
      reportId,
      customerCount: customerReports.length,
      pdfSize: pdfBuffer.length,
    });

    const summaryLines = customerReports.map(
      (c) =>
        `• ${c.customerName}: Sales ₹${c.totalSales.toFixed(2)}, Payments ₹${c.totalPayments.toFixed(2)}, Balance ₹${c.closingBalance.toFixed(2)}${c.closingBalance > 0 ? " (owes)" : c.closingBalance < 0 ? " (advance)" : " (settled)"}`,
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
        .describe(
          "Filter by specific customer IDs (resolved via search_customers)",
        ),
    }),
  },
);

export const listSalesTool = tool(
  async (input) => {
    logger.info("list_sales called", {
      userId: input.userId,
      customerId: input.customerId,
      fromDate: input.fromDate,
      toDate: input.toDate,
    });

    const conditions = [eq(sales.userId, input.userId)];
    if (input.customerId) {
      conditions.push(eq(sales.customerId, input.customerId));
    }
    if (input.fromDate && input.toDate) {
      conditions.push(between(sales.date, input.fromDate, input.toDate));
    }

    const rows = db
      .select()
      .from(sales)
      .where(and(...conditions))
      .orderBy(desc(sales.date))
      .all();

    if (rows.length === 0) return "No sales found.";

    // Get customer names
    const customerIds = [...new Set(rows.map((r) => r.customerId))];
    const customerMap = new Map<number, string>();
    for (const id of customerIds) {
      const c = db
        .select({ name: customers.name })
        .from(customers)
        .where(eq(customers.id, id))
        .get();
      if (c) customerMap.set(id, c.name);
    }

    const total = rows.reduce((sum, r) => sum + r.total, 0);
    const lines = rows.map((r) => {
      const items = JSON.parse(r.items) as {
        description: string;
        quantity: number;
        unit: string;
      }[];
      const itemSummary = items
        .map((i) => `${i.quantity}${i.unit} ${i.description}`)
        .join(", ");
      return `• ID:${r.id} | ${r.invoiceNumber} | ${r.date} | ${customerMap.get(r.customerId) || "?"} | ${itemSummary} | ₹${r.total.toFixed(2)}`;
    });

    return `Sales (${rows.length}):\n${lines.join("\n")}\n\nTotal: ₹${total.toFixed(2)}`;
  },
  {
    name: "list_sales",
    description: `List sales/invoices. Optionally filter by customer and/or date range.
"Show Raju's bills" / "My sales today" / "All invoices this week"
BEFORE calling, if user mentions a customer name, search for them first.
No confirmation needed — read-only.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      customerId: z
        .number()
        .optional()
        .describe("Customer ID to filter by. Omit for all customers."),
      fromDate: z.string().optional().describe("Start date YYYY-MM-DD"),
      toDate: z.string().optional().describe("End date YYYY-MM-DD"),
    }),
  },
);

export const deleteSaleTool = tool(
  async (input) => {
    logger.info("delete_sale called", {
      userId: input.userId,
      saleId: input.saleId,
    });

    const sale = db
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.saleId), eq(sales.userId, input.userId)))
      .get();

    if (!sale) return "Sale not found.";

    const customer = db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, sale.customerId))
      .get()!;

    db.delete(sales).where(eq(sales.id, input.saleId)).run();

    logger.info("Sale deleted", {
      saleId: input.saleId,
      invoiceNumber: sale.invoiceNumber,
      customerName: customer.name,
    });
    return `Sale deleted: ${sale.invoiceNumber} — ${customer.name}, ₹${sale.total.toFixed(2)} on ${sale.date}.`;
  },
  {
    name: "delete_sale",
    description: `Delete/cancel a recorded sale. ONLY call AFTER user confirms.
BEFORE calling:
1. List sales for the customer (list_sales) so user can identify which one
2. Show the sale details (invoice number, amount, date, items)
3. Warn: "This will permanently delete invoice [INV-xxx] (₹X). Confirm? Yes/No"
4. ONLY on explicit yes → call this tool`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      saleId: z.number().describe("Sale/sale ID from list_sales results"),
    }),
  },
);

export const getSummaryTool = tool(
  async (input) => {
    logger.info("get_summary called", {
      userId: input.userId,
      fromDate: input.fromDate,
      toDate: input.toDate,
    });

    // Total sales in period
    const salesResult = db
      .select({
        count: sql<number>`COUNT(*)`,
        total: sql<number>`COALESCE(SUM(${sales.total}), 0)`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.userId, input.userId),
          between(sales.date, input.fromDate, input.toDate),
        ),
      )
      .get()!;

    // Total payments in period
    const paymentsResult = db
      .select({
        count: sql<number>`COUNT(*)`,
        total: sql<number>`COALESCE(SUM(${payments.amount}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.userId, input.userId),
          between(payments.date, input.fromDate, input.toDate),
        ),
      )
      .get()!;

    // Total customers
    const customerCount = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(customers)
      .where(eq(customers.userId, input.userId))
      .get()!.count;

    // Total outstanding balance across all customers
    const allCustomers = db
      .select()
      .from(customers)
      .where(eq(customers.userId, input.userId))
      .all();

    let totalOwed = 0;
    let totalAdvance = 0;
    let oweCount = 0;

    for (const c of allCustomers) {
      const cSales = db
        .select({ total: sql<number>`COALESCE(SUM(${sales.total}), 0)` })
        .from(sales)
        .where(eq(sales.customerId, c.id))
        .get()!.total;

      const cPayments = db
        .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
        .from(payments)
        .where(eq(payments.customerId, c.id))
        .get()!.total;

      const balance = c.initialBalance + cSales - cPayments;
      if (balance > 0) {
        totalOwed += balance;
        oweCount++;
      } else if (balance < 0) {
        totalAdvance += Math.abs(balance);
      }
    }

    return [
      `Business Summary (${input.fromDate} to ${input.toDate}):`,
      ``,
      `Sales: ${salesResult.count} invoices — ₹${salesResult.total.toFixed(2)}`,
      `Payments: ${paymentsResult.count} received — ₹${paymentsResult.total.toFixed(2)}`,
      ``,
      `Total customers: ${customerCount}`,
      `Customers with dues: ${oweCount}`,
      `Total outstanding: ₹${totalOwed.toFixed(2)}`,
      totalAdvance > 0 ? `Total advance: ₹${totalAdvance.toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  },
  {
    name: "get_summary",
    description: `Get a business summary/dashboard for a date range.
Shows: total sales count + amount, total payments count + amount, customer count, outstanding dues.
"How's my business today?" / "Summary for this month" / "Dashboard for April"
No confirmation needed — read-only.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      fromDate: z.string().describe("Start date YYYY-MM-DD"),
      toDate: z.string().describe("End date YYYY-MM-DD"),
    }),
  },
);
