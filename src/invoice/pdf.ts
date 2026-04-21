import PDFDocument from "pdfkit";
import type { Invoice } from "./types.ts";

function formatCurrency(amount: number): string {
  return (
    "Rs. " +
    amount.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export async function generateInvoicePdf(
  invoice: Invoice,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Uint8Array[] = [];

    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 100; // margins
    const leftX = 50;
    const rightX = doc.page.width - 50;

    // --- Header ---
    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("TAX INVOICE", leftX, 50, { align: "center" });

    doc
      .moveTo(leftX, 80)
      .lineTo(rightX, 80)
      .lineWidth(2)
      .stroke();

    // --- Seller Info (left) + Invoice Meta (right) ---
    let y = 95;

    doc.fontSize(12).font("Helvetica-Bold").text(invoice.sellerName, leftX, y);
    y += 16;
    doc.fontSize(9).font("Helvetica");
    if (invoice.sellerAddress) {
      doc.text(invoice.sellerAddress, leftX, y);
      y += 13;
    }
    if (invoice.sellerGstin) {
      doc.text(`GSTIN: ${invoice.sellerGstin}`, leftX, y);
      y += 13;
    }
    if (invoice.sellerPhone) {
      doc.text(`Phone: ${invoice.sellerPhone}`, leftX, y);
      y += 13;
    }

    // Invoice number and date on the right
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .text(`Invoice: ${invoice.invoiceNumber}`, 350, 95, { align: "right" });
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`Date: ${invoice.date}`, 350, 111, { align: "right" });

    // --- Customer Info ---
    y = Math.max(y, 130) + 10;
    doc
      .moveTo(leftX, y)
      .lineTo(rightX, y)
      .lineWidth(0.5)
      .stroke();
    y += 10;

    doc.fontSize(10).font("Helvetica-Bold").text("Bill To:", leftX, y);
    y += 14;
    doc.fontSize(10).font("Helvetica").text(invoice.customerName, leftX, y);
    y += 14;
    if (invoice.customerPhone) {
      doc.text(`Phone: ${invoice.customerPhone}`, leftX, y);
      y += 14;
    }
    if (invoice.customerAddress) {
      doc.text(invoice.customerAddress, leftX, y);
      y += 14;
    }
    if (invoice.customerGstin) {
      doc.text(`GSTIN: ${invoice.customerGstin}`, leftX, y);
      y += 14;
    }

    y += 10;

    // --- Items Table ---
    const cols = {
      sno: leftX,
      desc: leftX + 35,
      qty: leftX + 220,
      unit: leftX + 270,
      rate: leftX + 310,
      gst: leftX + 390,
      amount: leftX + 430,
    };

    // Table header background
    doc.rect(leftX, y, pageWidth, 20).fill("#f0f0f0");

    doc.fillColor("#000000").fontSize(9).font("Helvetica-Bold");
    y += 5;
    doc.text("#", cols.sno, y, { width: 30 });
    doc.text("Description", cols.desc, y, { width: 180 });
    doc.text("Qty", cols.qty, y, { width: 45, align: "right" });
    doc.text("Unit", cols.unit, y, { width: 35, align: "center" });
    doc.text("Rate", cols.rate, y, { width: 75, align: "right" });
    doc.text("GST%", cols.gst, y, { width: 35, align: "right" });
    doc.text("Amount", cols.amount, y, { width: 65, align: "right" });
    y += 20;

    // Table rows
    doc.font("Helvetica").fontSize(9);
    for (let i = 0; i < invoice.items.length; i++) {
      const item = invoice.items[i];
      const amount = item.quantity * item.rate;

      // Alternate row background
      if (i % 2 === 1) {
        doc.rect(leftX, y - 3, pageWidth, 18).fill("#fafafa");
        doc.fillColor("#000000");
      }

      doc.text(`${i + 1}`, cols.sno, y, { width: 30 });
      doc.text(item.description, cols.desc, y, { width: 180 });
      doc.text(`${item.quantity}`, cols.qty, y, { width: 45, align: "right" });
      doc.text(item.unit, cols.unit, y, { width: 35, align: "center" });
      doc.text(formatCurrency(item.rate), cols.rate, y, {
        width: 75,
        align: "right",
      });
      doc.text(`${item.gstPercent}%`, cols.gst, y, {
        width: 35,
        align: "right",
      });
      doc.text(formatCurrency(amount), cols.amount, y, {
        width: 65,
        align: "right",
      });
      y += 18;
    }

    // Line below items
    y += 5;
    doc
      .moveTo(leftX, y)
      .lineTo(rightX, y)
      .lineWidth(1)
      .stroke();
    y += 12;

    // --- Totals ---
    const labelX = cols.rate;
    const valueX = cols.amount;

    doc.fontSize(10).font("Helvetica");
    doc.text("Subtotal:", labelX, y, { width: 75, align: "right" });
    doc.text(formatCurrency(invoice.subtotal), valueX, y, {
      width: 65,
      align: "right",
    });
    y += 16;

    if (invoice.totalGst > 0) {
      doc.text("GST:", labelX, y, { width: 75, align: "right" });
      doc.text(formatCurrency(invoice.totalGst), valueX, y, {
        width: 65,
        align: "right",
      });
      y += 16;
    }

    // Total with bold line
    doc
      .moveTo(labelX, y)
      .lineTo(rightX, y)
      .lineWidth(1)
      .stroke();
    y += 8;

    doc.fontSize(12).font("Helvetica-Bold");
    doc.text("Total:", labelX, y, { width: 75, align: "right" });
    doc.text(formatCurrency(invoice.total), valueX, y, {
      width: 65,
      align: "right",
    });

    doc.end();
  });
}
