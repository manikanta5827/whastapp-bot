import type { Invoice } from "./types.ts";
import { formatCurrencyWhatsApp as fmt } from "./pdfHelpers.ts";

export function formatInvoiceForWhatsApp(invoice: Invoice): string {
  const lines: string[] = [];

  // Header
  lines.push("📄 *INVOICE*");
  lines.push("");

  // Seller info
  if (invoice.sellerName) {
    lines.push(`*From:* ${invoice.sellerName}`);
  }
  if (invoice.sellerAddress) lines.push(invoice.sellerAddress);
  if (invoice.sellerGstin) lines.push(`GSTIN: ${invoice.sellerGstin}`);
  if (invoice.sellerPhone) lines.push(`Phone: ${invoice.sellerPhone}`);

  lines.push("");
  lines.push(`*Invoice:* ${invoice.invoiceNumber}`);
  lines.push(`*Date:* ${invoice.date}`);

  // Customer
  lines.push("");
  lines.push(`*Bill To:* ${invoice.customerName}`);
  if (invoice.customerPhone) lines.push(`Phone: ${invoice.customerPhone}`);
  if (invoice.customerAddress) lines.push(invoice.customerAddress);
  if (invoice.customerGstin) lines.push(`GSTIN: ${invoice.customerGstin}`);

  // Items
  lines.push("");
  lines.push("▸ *Items*");
  lines.push("─────────────────");

  for (let i = 0; i < invoice.items.length; i++) {
    const item = invoice.items[i];
    const amount = item.quantity * item.rate;

    lines.push(`${i + 1}. ${item.description}`);
    lines.push(
      `    ${item.quantity} ${item.unit} × ${fmt(item.rate)} = ${fmt(amount)}`,
    );

    if (item.gstPercent > 0) {
      const gstAmount = (amount * item.gstPercent) / 100;
      lines.push(`    _+ GST ${item.gstPercent}%: ${fmt(gstAmount)}_`);
    }
  }

  // Totals
  lines.push("─────────────────");
  lines.push(`Subtotal: ${fmt(invoice.subtotal)}`);
  if (invoice.totalGst > 0) {
    lines.push(`GST: ${fmt(invoice.totalGst)}`);
  }
  lines.push(`*Total: ${fmt(invoice.total)}*`);

  return lines.join("\n");
}
