import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { and, eq, lt, lte, between, desc, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { customers, sales, payments } from "../db/schema.ts";
import logger from "../logger.ts";

function getBalance(customerId: number, upToDate?: string) {
  const customer = db
    .select({ initialBalance: customers.initialBalance })
    .from(customers)
    .where(eq(customers.id, customerId))
    .get()!;

  const salesConditions = [eq(sales.customerId, customerId)];
  const paymentConditions = [eq(payments.customerId, customerId)];

  if (upToDate) {
    salesConditions.push(lte(sales.date, upToDate));
    paymentConditions.push(lte(payments.date, upToDate));
  }

  const totalSales = db
    .select({ total: sql<number>`COALESCE(SUM(${sales.total}), 0)` })
    .from(sales)
    .where(and(...salesConditions))
    .get()!.total;

  const totalPayments = db
    .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
    .from(payments)
    .where(and(...paymentConditions))
    .get()!.total;

  // Balance = what customer owes = initial + sales - payments
  return customer.initialBalance + totalSales - totalPayments;
}

export const recordPaymentTool = tool(
  async (input) => {
    logger.info("record_payment called", {
      userId: input.userId,
      customerId: input.customerId,
      amount: input.amount,
      mode: input.mode,
      date: input.date,
    });
    db.insert(payments)
      .values({
        userId: input.userId,
        customerId: input.customerId,
        amount: input.amount,
        mode: input.mode,
        note: input.note,
        date: input.date,
      })
      .run();

    const balance = getBalance(input.customerId);
    const customer = db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .get()!;

    return `Payment of ₹${input.amount.toFixed(2)} recorded for ${customer.name}${input.mode ? ` (${input.mode})` : ""}. Current balance: ₹${balance.toFixed(2)}${balance > 0 ? " (owes)" : balance < 0 ? " (advance)" : " (settled)"}`;
  },
  {
    name: "record_payment",
    description: `Record a payment received from a customer. BEFORE calling:
1. Search for the customer using search_customers
2. If multiple matches, ask user to pick
3. Show payment details and ask for confirmation
4. ONLY on explicit yes → call this tool`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      customerId: z.number().describe("Customer ID from search"),
      amount: z.number().describe("Payment amount in rupees"),
      mode: z
        .string()
        .optional()
        .describe('Payment mode: "cash", "upi", "bank", "cheque", etc.'),
      note: z.string().optional().describe("Optional note about the payment"),
      date: z
        .string()
        .describe(
          "Payment date YYYY-MM-DD. Use the date user mentions (e.g. 'yesterday', 'last week'). Default to today from context if not specified.",
        ),
    }),
  },
);

export const getBalancesTool = tool(
  async (input) => {
    logger.info("get_balances called", {
      userId: input.userId,
      customerIds: input.customerIds,
      asOfDate: input.asOfDate,
    });
    // Determine which customers
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
      // All customers for this user
      customerRows = db
        .select()
        .from(customers)
        .where(eq(customers.userId, input.userId))
        .all();
    }

    if (customerRows.length === 0) return "No customers found.";

    let totalOwed = 0;
    let totalAdvance = 0;

    const lines = customerRows.map((c) => {
      const balance = getBalance(c.id, input.asOfDate);
      if (balance > 0) totalOwed += balance;
      else totalAdvance += Math.abs(balance);
      const status = balance > 0 ? "owes" : balance < 0 ? "advance" : "settled";
      return `• ${c.name}: ₹${Math.abs(balance).toFixed(2)} (${status})`;
    });

    const summary =
      customerRows.length > 1
        ? `\n\nTotal owed: ₹${totalOwed.toFixed(2)} | Total advance: ₹${totalAdvance.toFixed(2)}`
        : "";

    const dateLabel = input.asOfDate ? ` as of ${input.asOfDate}` : "";

    return `Balances${dateLabel}:\n${lines.join("\n")}${summary}`;
  },
  {
    name: "get_balances",
    description: `Get balances for one, multiple, or all customers. Optionally as of a specific date.
- "What does Sunrise owe?" → search customer, pass customerIds: [id]
- "All balances" → pass no customerIds
- "Balances as of April 15" → pass asOfDate
- "How much does Raju and Sunrise owe?" → search both, pass customerIds: [id1, id2]

BEFORE calling, if user mentions customer names, search for each first (same disambiguation rules).
No confirmation needed — read-only.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      customerIds: z
        .array(z.number())
        .optional()
        .describe("Customer IDs to check. Omit for ALL customers."),
      asOfDate: z
        .string()
        .optional()
        .describe(
          "Calculate balance as of this date (YYYY-MM-DD). Omit for current balance.",
        ),
    }),
  },
);

export const listPaymentsTool = tool(
  async (input) => {
    logger.info("list_payments called", {
      userId: input.userId,
      customerId: input.customerId,
      fromDate: input.fromDate,
      toDate: input.toDate,
    });

    const conditions = [
      eq(payments.userId, input.userId),
      eq(payments.customerId, input.customerId),
    ];
    if (input.fromDate && input.toDate) {
      conditions.push(between(payments.date, input.fromDate, input.toDate));
    }

    const rows = db
      .select()
      .from(payments)
      .where(and(...conditions))
      .orderBy(desc(payments.date))
      .all();

    if (rows.length === 0) return "No payments found.";

    const customer = db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .get()!;

    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    const lines = rows.map(
      (r) =>
        `• ID:${r.id} | ${r.date} | ₹${r.amount.toFixed(2)} | ${r.mode || "-"} | ${r.note || "-"}`,
    );

    return `Payments for ${customer.name} (${rows.length}):\n${lines.join("\n")}\n\nTotal: ₹${total.toFixed(2)}`;
  },
  {
    name: "list_payments",
    description: `List payment history for a customer. Optionally filter by date range.
"Show Raju's payments" / "Sunrise payments this month" / "What payments did Raju make?"
BEFORE calling, search for the customer first (same disambiguation rules).
No confirmation needed — read-only.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      customerId: z.number().describe("Customer ID from search"),
      fromDate: z.string().optional().describe("Start date YYYY-MM-DD"),
      toDate: z.string().optional().describe("End date YYYY-MM-DD"),
    }),
  },
);

export const updatePaymentTool = tool(
  async (input) => {
    logger.info("update_payment called", {
      userId: input.userId,
      paymentId: input.paymentId,
    });

    const payment = db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, input.paymentId),
          eq(payments.userId, input.userId),
        ),
      )
      .get();

    if (!payment) return "Payment not found.";

    db.update(payments)
      .set({
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.mode !== undefined && { mode: input.mode }),
        ...(input.note !== undefined && { note: input.note }),
        ...(input.date && { date: input.date }),
      })
      .where(eq(payments.id, input.paymentId))
      .run();

    const updated = db
      .select()
      .from(payments)
      .where(eq(payments.id, input.paymentId))
      .get()!;
    const customer = db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, updated.customerId))
      .get()!;
    const balance = getBalance(updated.customerId);

    logger.info("Payment updated", { paymentId: input.paymentId });
    return `Payment ID:${updated.id} updated for ${customer.name}:\n• Amount: ₹${updated.amount.toFixed(2)}\n• Mode: ${updated.mode || "-"}\n• Date: ${updated.date}\n• Note: ${updated.note || "-"}\nCurrent balance: ₹${balance.toFixed(2)}${balance > 0 ? " (owes)" : balance < 0 ? " (advance)" : " (settled)"}`;
  },
  {
    name: "update_payment",
    description: `Update a payment record. ONLY call AFTER user confirms.
BEFORE calling:
1. List payments for the customer (list_payments) so user can identify which one
2. Show current payment details and proposed changes
3. Ask for confirmation
4. ONLY on explicit yes → call this tool`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      paymentId: z.number().describe("Payment ID from list_payments results"),
      amount: z.number().optional().describe("Updated amount"),
      mode: z.string().optional().describe("Updated payment mode"),
      note: z.string().optional().describe("Updated note"),
      date: z.string().optional().describe("Updated date YYYY-MM-DD"),
    }),
  },
);

export const deletePaymentTool = tool(
  async (input) => {
    logger.info("delete_payment called", {
      userId: input.userId,
      paymentId: input.paymentId,
    });

    const payment = db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, input.paymentId),
          eq(payments.userId, input.userId),
        ),
      )
      .get();

    if (!payment) return "Payment not found.";

    const customer = db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, payment.customerId))
      .get()!;

    db.delete(payments).where(eq(payments.id, input.paymentId)).run();

    const balance = getBalance(payment.customerId);

    logger.info("Payment deleted", {
      paymentId: input.paymentId,
      customerName: customer.name,
    });
    return `Payment ID:${input.paymentId} deleted (₹${payment.amount.toFixed(2)} from ${customer.name} on ${payment.date}). Current balance: ₹${balance.toFixed(2)}${balance > 0 ? " (owes)" : balance < 0 ? " (advance)" : " (settled)"}`;
  },
  {
    name: "delete_payment",
    description: `Delete a payment record. ONLY call AFTER user confirms.
BEFORE calling:
1. List payments for the customer (list_payments)
2. Show the payment details to be deleted
3. Warn: "This will remove the ₹X payment from [customer] on [date]. Confirm? Yes/No"
4. ONLY on explicit yes → call this tool`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      paymentId: z.number().describe("Payment ID to delete"),
    }),
  },
);
