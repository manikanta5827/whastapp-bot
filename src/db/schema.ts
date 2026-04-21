import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql, type InferSelectModel } from "drizzle-orm";

export type User = InferSelectModel<typeof users>;
export type Customer = InferSelectModel<typeof customers>;
export type sale = InferSelectModel<typeof sales>;
export type Payment = InferSelectModel<typeof payments>;

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  phone: text("phone").notNull().unique(),
  businessName: text("business_name"),
  address: text("address"),
  gstin: text("gstin"),
  proprietorName: text("proprietor_name"),
  businessPhone: text("business_phone"),
  language: text("language").default("english"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  gstin: text("gstin"),
  initialBalance: real("initial_balance").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sales = sqliteTable("sales", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceNumber: text("invoice_number").notNull(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  items: text("items").notNull(),
  subtotal: real("subtotal").notNull(),
  totalGst: real("total_gst").notNull(),
  total: real("total").notNull(),
  date: text("date").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  amount: real("amount").notNull(),
  mode: text("mode"),
  note: text("note"),
  date: text("date").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ["human", "ai"] }).notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
