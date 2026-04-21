import type { Invoice } from "./types.ts";

function formatCurrency(amount: number): string {
  return (
    "₹" +
    amount.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

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

    lines.push(
      `${i + 1}. ${item.description}`,
    );
    lines.push(
      `    ${item.quantity} ${item.unit} × ${formatCurrency(item.rate)} = ${formatCurrency(amount)}`,
    );

    if (item.gstPercent > 0) {
      const gstAmount = (amount * item.gstPercent) / 100;
      lines.push(`    _+ GST ${item.gstPercent}%: ${formatCurrency(gstAmount)}_`);
    }
  }

  // Totals
  lines.push("─────────────────");
  lines.push(`Subtotal: ${formatCurrency(invoice.subtotal)}`);
  if (invoice.totalGst > 0) {
    lines.push(`GST: ${formatCurrency(invoice.totalGst)}`);
  }
  lines.push(`*Total: ${formatCurrency(invoice.total)}*`);

  return lines.join("\n");
}
