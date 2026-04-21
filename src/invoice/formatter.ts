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

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

export function formatInvoiceForWhatsApp(invoice: Invoice): string {
  const lines: string[] = [];

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("           *INVOICE*");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");

  // Seller info
  if (invoice.sellerName) {
    lines.push(`*From:* ${invoice.sellerName}`);
  }
  if (invoice.sellerAddress) {
    lines.push(invoice.sellerAddress);
  }
  if (invoice.sellerGstin) {
    lines.push(`GSTIN: ${invoice.sellerGstin}`);
  }
  lines.push("");

  // Invoice details
  lines.push(`*Invoice #:* ${invoice.invoiceNumber}`);
  lines.push(`*Date:* ${invoice.date}`);
  lines.push("");

  // Customer info
  lines.push(`*Bill To:* ${invoice.customerName}`);
  if (invoice.customerPhone) {
    lines.push(`Phone: ${invoice.customerPhone}`);
  }
  lines.push("");

  // Items header
  lines.push("─────────────────────────────");
  lines.push(
    `${pad("Item", 16)} ${padLeft("Qty", 6)} ${padLeft("Rate", 8)} ${padLeft("Amount", 10)}`,
  );
  lines.push("─────────────────────────────");

  // Items
  for (const item of invoice.items) {
    const amount = item.quantity * item.rate;
    const desc =
      item.description.length > 15
        ? item.description.slice(0, 14) + "…"
        : item.description;

    lines.push(
      `${pad(desc, 16)} ${padLeft(item.quantity + item.unit, 6)} ${padLeft(formatCurrency(item.rate), 8)} ${padLeft(formatCurrency(amount), 10)}`,
    );

    if (item.gstPercent > 0) {
      const gstAmount = (amount * item.gstPercent) / 100;
      lines.push(`  _GST ${item.gstPercent}%: ${formatCurrency(gstAmount)}_`);
    }
  }

  lines.push("─────────────────────────────");

  // Totals
  lines.push(
    `${pad("", 16)} ${padLeft("Subtotal:", 14)} ${padLeft(formatCurrency(invoice.subtotal), 10)}`,
  );
  if (invoice.totalGst > 0) {
    lines.push(
      `${pad("", 16)} ${padLeft("GST:", 14)} ${padLeft(formatCurrency(invoice.totalGst), 10)}`,
    );
  }
  lines.push("─────────────────────────────");
  lines.push(
    `${pad("", 16)} *${padLeft("TOTAL:", 13)} ${padLeft(formatCurrency(invoice.total), 10)}*`,
  );
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return lines.join("\n");
}
