import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { and, eq, like } from "drizzle-orm";
import { db } from "../db/index.ts";
import { users, customers, purchases } from "../db/schema.ts";
import { generateInvoicePdf, generateBulkInvoicePdf } from "../invoice/pdf.ts";
import { storePdf } from "../invoice/pdfStore.ts";

const customerSchema = z.object({
  name: z.string().describe("Customer name"),
  phone: z.string().optional().describe("Customer phone number"),
  address: z.string().optional().describe("Customer address"),
  city: z.string().optional().describe("Customer city"),
  gstin: z.string().optional().describe("Customer GST number"),
});

export const createCustomersTool = tool(
  async (input) => {
    const added: string[] = [];
    const duplicates: string[] = [];

    for (const c of input.customers) {
      const existing = db
        .select()
        .from(customers)
        .where(and(eq(customers.userId, input.userId), eq(customers.name, c.name)))
        .get();

      if (existing) {
        duplicates.push(c.name);
        continue;
      }

      db.insert(customers)
        .values({
          userId: input.userId,
          name: c.name,
          phone: c.phone,
          address: c.address,
          city: c.city,
          gstin: c.gstin,
        })
        .run();
      added.push(c.name);
    }

    const parts: string[] = [];
    if (added.length === 1) parts.push(`Customer "${added[0]}" added.`);
    else if (added.length > 1) parts.push(`${added.length} customers added: ${added.join(", ")}.`);
    if (duplicates.length > 0)
      parts.push(`Already exists (skipped): ${duplicates.join(", ")}. Use update_customer to modify.`);
    if (parts.length === 0) return "All customers already exist.";
    return parts.join("\n");
  },
  {
    name: "create_customers",
    description: `Add one or more customers. Can handle single or bulk creation.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      customers: z
        .array(customerSchema)
        .describe("Array of customers to create"),
    }),
  },
);

export const updateCustomerTool = tool(
  async (input) => {
    const customer = db
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.userId, input.userId)))
      .get();

    if (!customer) return "Customer not found.";

    db.update(customers)
      .set({
        ...(input.name && { name: input.name }),
        ...(input.customerPhone && { phone: input.customerPhone }),
        ...(input.address && { address: input.address }),
        ...(input.city && { city: input.city }),
        ...(input.gstin && { gstin: input.gstin }),
      })
      .where(eq(customers.id, input.customerId))
      .run();

    return `Customer "${input.name || customer.name}" updated successfully.`;
  },
  {
    name: "update_customer",
    description: `Update a customer's details. ONLY call this AFTER the user has confirmed. Before calling, show the current details and proposed changes, then ask "Confirm update? Yes/No".`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      customerId: z.number().describe("Customer ID from search results"),
      name: z.string().optional().describe("Updated name"),
      customerPhone: z.string().optional().describe("Updated phone"),
      address: z.string().optional().describe("Updated address"),
      city: z.string().optional().describe("Updated city"),
      gstin: z.string().optional().describe("Updated GST number"),
    }),
  },
);

export const deleteCustomerTool = tool(
  async (input) => {
    const customer = db
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.userId, input.userId)))
      .get();

    if (!customer) return "Customer not found.";

    // Get all purchases for this customer
    const customerPurchases = db
      .select()
      .from(purchases)
      .where(eq(purchases.customerId, input.customerId))
      .all();

    // Get seller info for PDF generation
    const user = db.select().from(users).where(eq(users.id, input.userId)).get()!;
    const seller = {
      name: user.businessName!,
      address: user.address || "",
      gstin: user.gstin || "",
      phone: user.businessPhone!,
    };

    // Generate one combined backup PDF before deleting
    const backupKey = `BACKUP-${customer.name.replace(/\s+/g, "-")}-${Date.now()}`;

    if (customerPurchases.length > 0) {
      const invoices = customerPurchases.map((p) => ({
        invoiceNumber: p.invoiceNumber,
        date: p.date,
        customerName: customer.name,
        customerPhone: customer.phone || undefined,
        customerAddress: customer.address || undefined,
        customerGstin: customer.gstin || undefined,
        sellerName: seller.name,
        sellerAddress: seller.address,
        sellerGstin: seller.gstin,
        sellerPhone: seller.phone,
        items: JSON.parse(p.items),
        subtotal: p.subtotal,
        totalGst: p.totalGst,
        total: p.total,
      }));

      const pdfBuffer = invoices.length === 1
        ? await generateInvoicePdf(invoices[0])
        : await generateBulkInvoicePdf(invoices);
      storePdf(backupKey, pdfBuffer);

      // Delete purchases first, then customer
      db.delete(purchases)
        .where(eq(purchases.customerId, input.customerId))
        .run();
    }

    db.delete(customers)
      .where(eq(customers.id, input.customerId))
      .run();

    if (customerPurchases.length > 0) {
      return `Customer "${customer.name}" deleted along with ${customerPurchases.length} purchase record(s). Sending backup PDF with all invoices: ${backupKey}`;
    }

    return `Customer "${customer.name}" deleted. No purchase records to back up.`;
  },
  {
    name: "delete_customer",
    description: `Delete a customer and all their purchase records. ONLY call this AFTER the user has confirmed.
Before calling, you MUST:
1. Search for the customer
2. Show their details and number of purchase records
3. Warn: "This will delete the customer and X purchase records. Backup PDFs will be sent before deletion. Confirm? Yes/No"
4. ONLY on explicit yes → call this tool`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      customerId: z.number().describe("Customer ID to delete"),
    }),
  },
);

export const searchCustomersTool = tool(
  async (input) => {
    const results = db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.userId, input.userId),
          like(customers.name, `%${input.query}%`),
        ),
      )
      .all();

    if (results.length === 0) {
      return `No customers found matching "${input.query}". You can create a new customer.`;
    }

    // Include purchase count for each customer
    if (results.length === 1) {
      const c = results[0];
      const pCount = db.select({ id: purchases.id }).from(purchases)
        .where(eq(purchases.customerId, c.id)).all().length;
      return `Found 1 customer:\n• ID:${c.id} | ${c.name}${c.phone ? ` | Ph: ${c.phone}` : ""}${c.city ? ` | ${c.city}` : ""}${c.gstin ? ` | GSTIN: ${c.gstin}` : ""} | ${pCount} purchase(s)`;
    }

    const list = results
      .map((c) => {
        const pCount = db.select({ id: purchases.id }).from(purchases)
          .where(eq(purchases.customerId, c.id)).all().length;
        return `• ID:${c.id} | ${c.name}${c.phone ? ` | Ph: ${c.phone}` : ""}${c.city ? ` | ${c.city}` : ""}${c.gstin ? ` | GSTIN: ${c.gstin}` : ""} | ${pCount} purchase(s)`;
      })
      .join("\n");

    return `Found ${results.length} customers matching "${input.query}":\n${list}\n\nPlease specify which customer (by ID, city, or GSTIN) to avoid picking the wrong one.`;
  },
  {
    name: "search_customers",
    description: `Search customers by name. Use BEFORE any invoice, update, or delete operation.
If multiple matches, ask user to clarify. If no match, offer to create. If one match, use it.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      query: z.string().describe("Customer name to search for"),
    }),
  },
);
