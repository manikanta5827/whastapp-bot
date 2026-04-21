import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { and, eq, lt, lte, between, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { customers, purchases, payments } from "../db/schema.ts";

function getBalance(customerId: number, upToDate?: string) {
  const customer = db
    .select({ initialBalance: customers.initialBalance })
    .from(customers)
    .where(eq(customers.id, customerId))
    .get()!;

  const salesConditions = [eq(purchases.customerId, customerId)];
  const paymentConditions = [eq(payments.customerId, customerId)];

  if (upToDate) {
    salesConditions.push(lte(purchases.date, upToDate));
    paymentConditions.push(lte(payments.date, upToDate));
  }

  const totalSales = db
    .select({ total: sql<number>`COALESCE(SUM(${purchases.total}), 0)` })
    .from(purchases)
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
      date: z.string().describe("Payment date YYYY-MM-DD (use today from context)"),
    }),
  },
);

export const getBalancesTool = tool(
  async (input) => {
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
      const status =
        balance > 0 ? "owes" : balance < 0 ? "advance" : "settled";
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
        .describe("Calculate balance as of this date (YYYY-MM-DD). Omit for current balance."),
    }),
  },
);
