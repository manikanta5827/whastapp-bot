import { eq, like } from "drizzle-orm";
import { db } from "../db/index.ts";
import { purchases } from "../db/schema.ts";
import type { Invoice, InvoiceItem } from "./types.ts";

function generateInvoiceNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `INV-${dateStr}-`;

  // Find the highest existing invoice number for today
  const latest = db
    .select({ invoiceNumber: purchases.invoiceNumber })
    .from(purchases)
    .where(like(purchases.invoiceNumber, `${prefix}%`))
    .all();

  let maxSeq = 0;
  for (const row of latest) {
    const seq = parseInt(row.invoiceNumber.slice(-3), 10);
    if (seq > maxSeq) maxSeq = seq;
  }

  const seq = String(maxSeq + 1).padStart(3, "0");
  return `${prefix}${seq}`;
}

export interface SellerInfo {
  name: string;
  address: string;
  gstin: string;
  phone: string;
}

export interface CustomerInfo {
  name: string;
  phone?: string;
  address?: string;
  gstin?: string;
}

export function createInvoice(
  seller: SellerInfo,
  customer: CustomerInfo,
  items: InvoiceItem[],
): Invoice {
  let subtotal = 0;
  let totalGst = 0;

  for (const item of items) {
    const itemTotal = item.quantity * item.rate;
    const itemGst = (itemTotal * item.gstPercent) / 100;
    subtotal += itemTotal;
    totalGst += itemGst;
  }

  return {
    invoiceNumber: generateInvoiceNumber(),
    date: new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    customerName: customer.name,
    customerPhone: customer.phone,
    customerAddress: customer.address,
    customerGstin: customer.gstin,
    sellerName: seller.name,
    sellerAddress: seller.address,
    sellerGstin: seller.gstin,
    sellerPhone: seller.phone,
    items,
    subtotal,
    totalGst,
    total: subtotal + totalGst,
  };
}
