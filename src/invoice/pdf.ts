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

const LEFT_X = 50;
const ROW_HEIGHT = 18;

function getPageBottom(doc: PDFKit.PDFDocument): number {
  return doc.page.height - 50; // bottom margin
}

function getRightX(doc: PDFKit.PDFDocument): number {
  return doc.page.width - 50;
}

function getPageWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - 100;
}

function getCols() {
  return {
    sno: LEFT_X,
    desc: LEFT_X + 35,
    qty: LEFT_X + 220,
    unit: LEFT_X + 270,
    rate: LEFT_X + 310,
    gst: LEFT_X + 390,
    amount: LEFT_X + 430,
  };
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  const cols = getCols();
  const pageWidth = getPageWidth(doc);

  doc.rect(LEFT_X, y, pageWidth, 20).fill("#f0f0f0");
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

  return y;
}

function drawContinuationHeader(
  doc: PDFKit.PDFDocument,
  invoice: Invoice,
): number {
  const rightX = getRightX(doc);
  let y = 50;

  doc.fontSize(9).font("Helvetica").fillColor("#666666");
  doc.text(
    `${invoice.invoiceNumber} — ${invoice.customerName} (continued)`,
    LEFT_X,
    y,
  );
  y += 16;

  doc
    .moveTo(LEFT_X, y)
    .lineTo(rightX, y)
    .lineWidth(0.5)
    .strokeColor("#cccccc")
    .stroke();
  doc.strokeColor("#000000").fillColor("#000000");
  y += 10;

  return y;
}

function renderInvoice(doc: PDFKit.PDFDocument, invoice: Invoice): void {
  const rightX = getRightX(doc);
  const pageWidth = getPageWidth(doc);
  const pageBottom = getPageBottom(doc);

  // --- Header ---
  doc
    .fontSize(22)
    .font("Helvetica-Bold")
    .text("TAX INVOICE", LEFT_X, 50, { align: "center" });

  doc
    .moveTo(LEFT_X, 80)
    .lineTo(rightX, 80)
    .lineWidth(2)
    .stroke();

  // --- Seller Info (left) + Invoice Meta (right) ---
  let y = 95;

  doc.fontSize(12).font("Helvetica-Bold").text(invoice.sellerName, LEFT_X, y);
  y += 16;
  doc.fontSize(9).font("Helvetica");
  if (invoice.sellerAddress) {
    doc.text(invoice.sellerAddress, LEFT_X, y);
    y += 13;
  }
  if (invoice.sellerGstin) {
    doc.text(`GSTIN: ${invoice.sellerGstin}`, LEFT_X, y);
    y += 13;
  }
  if (invoice.sellerPhone) {
    doc.text(`Phone: ${invoice.sellerPhone}`, LEFT_X, y);
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
    .moveTo(LEFT_X, y)
    .lineTo(rightX, y)
    .lineWidth(0.5)
    .stroke();
  y += 10;

  doc.fontSize(10).font("Helvetica-Bold").text("Bill To:", LEFT_X, y);
  y += 14;
  doc.fontSize(10).font("Helvetica").text(invoice.customerName, LEFT_X, y);
  y += 14;
  if (invoice.customerPhone) {
    doc.text(`Phone: ${invoice.customerPhone}`, LEFT_X, y);
    y += 14;
  }
  if (invoice.customerAddress) {
    doc.text(invoice.customerAddress, LEFT_X, y);
    y += 14;
  }
  if (invoice.customerGstin) {
    doc.text(`GSTIN: ${invoice.customerGstin}`, LEFT_X, y);
    y += 14;
  }

  y += 10;

  // --- Items Table ---
  const cols = getCols();
  y = drawTableHeader(doc, y);

  // Table rows with page overflow handling
  doc.font("Helvetica").fontSize(9);
  for (let i = 0; i < invoice.items.length; i++) {
    // Check if we need a new page for this row
    if (y + ROW_HEIGHT > pageBottom) {
      doc.addPage();
      y = drawContinuationHeader(doc, invoice);
      y = drawTableHeader(doc, y);
      doc.font("Helvetica").fontSize(9);
    }

    const item = invoice.items[i];
    const amount = item.quantity * item.rate;

    if (i % 2 === 1) {
      doc.rect(LEFT_X, y - 3, pageWidth, ROW_HEIGHT).fill("#fafafa");
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
    y += ROW_HEIGHT;
  }

  // --- Totals (need ~60px of space) ---
  const totalsHeight = 60 + (invoice.totalGst > 0 ? 16 : 0);
  if (y + totalsHeight > pageBottom) {
    doc.addPage();
    y = drawContinuationHeader(doc, invoice);
  }

  // Line below items
  y += 5;
  doc
    .moveTo(LEFT_X, y)
    .lineTo(rightX, y)
    .lineWidth(1)
    .stroke();
  y += 12;

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
}

/** Generate a single-invoice PDF */
export async function generateInvoicePdf(
  invoice: Invoice,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Uint8Array[] = [];

    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    renderInvoice(doc, invoice);
    doc.end();
  });
}

/** Generate a combined PDF with multiple invoices (each starts on a new page) */
export async function generateBulkInvoicePdf(
  invoices: Invoice[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Uint8Array[] = [];

    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    for (let i = 0; i < invoices.length; i++) {
      if (i > 0) doc.addPage();
      renderInvoice(doc, invoices[i]);
    }

    doc.end();
  });
}
