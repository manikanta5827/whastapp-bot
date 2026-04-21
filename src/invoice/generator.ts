import { config } from "../config.ts";
import type { Invoice, InvoiceItem } from "./types.ts";

let invoiceCounter = 0;

function generateInvoiceNumber(): string {
  invoiceCounter++;
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const seq = String(invoiceCounter).padStart(3, "0");
  return `INV-${dateStr}-${seq}`;
}

export function createInvoice(
  customerName: string,
  items: InvoiceItem[],
  customerPhone?: string,
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
    customerName,
    customerPhone,
    sellerName: config.seller.name,
    sellerAddress: config.seller.address,
    sellerGstin: config.seller.gstin,
    items,
    subtotal,
    totalGst,
    total: subtotal + totalGst,
  };
}
