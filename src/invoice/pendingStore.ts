import type { Invoice } from "./types.ts";

// Stores pending invoices awaiting user confirmation before PDF generation
const pendingInvoices = new Map<string, Invoice>();

export function storePending(invoiceNumber: string, invoice: Invoice): void {
  pendingInvoices.set(invoiceNumber, invoice);
}

export function retrievePending(invoiceNumber: string): Invoice | undefined {
  const inv = pendingInvoices.get(invoiceNumber);
  if (inv) pendingInvoices.delete(invoiceNumber);
  return inv;
}
