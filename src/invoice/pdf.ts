import type { Invoice } from "./types.ts";
import {
  ROW_HEIGHT,
  formatCurrencyPdf as fmt,
  docToBuffer,
} from "./pdfHelpers.ts";

const MARGIN = 50;
const BLACK = "#000000";

function getRight(doc: PDFKit.PDFDocument) {
  return doc.page.width - MARGIN;
}

function getWidth(doc: PDFKit.PDFDocument) {
  return doc.page.width - MARGIN * 2;
}

function getBottom(doc: PDFKit.PDFDocument) {
  return doc.page.height - MARGIN;
}

function drawLine(
  doc: PDFKit.PDFDocument,
  y: number,
  dashed = false,
  width = 0.5,
) {
  if (dashed) {
    doc.dash(2, { space: 2 });
  } else {
    doc.undash();
  }
  doc
    .moveTo(MARGIN, y)
    .lineTo(getRight(doc), y)
    .lineWidth(width)
    .strokeColor(BLACK)
    .stroke();
  doc.undash();
}

function renderInvoice(doc: PDFKit.PDFDocument, invoice: Invoice): void {
  const rightX = getRight(doc);
  const pageWidth = getWidth(doc);
  const pageBottom = getBottom(doc);
  let y = MARGIN;

  // ── Header: Title ──
  doc.fontSize(18).font("Courier-Bold").fillColor(BLACK);
  doc.text("Invoice", MARGIN, y);
  y += 25;

  drawLine(doc, y, true);
  y += 10;

  // ── Customer Name ──
  doc.fontSize(14).font("Courier-Bold").text(`Name: ${invoice.customerName}`, MARGIN, y);
  y += 20;

  drawLine(doc, y);
  y += 10;

  // ── Billing Info (Columns) ──
  const colWidth = pageWidth / 2;
  doc.fontSize(11).font("Courier-Bold");
  
  doc.text(`Bill No: ${invoice.invoiceNumber}`, MARGIN, y);
  doc.text(`Date: ${invoice.date}`, MARGIN + colWidth, y);
  y += 15;
  
  // Note: Time is not in Invoice object, so we omit or could add current time if desired.
  // For now we follow the structure of the image as much as possible.
  
  y += 5;
  drawLine(doc, y, true);
  y += 10;

  // ── Items Table Header ──
  doc.fontSize(11).font("Courier-Bold");
  doc.text("Item Name", MARGIN, y);
  y += 15;
  doc.text("Qty x Price", MARGIN, y);
  doc.text("Amount (Savings)", rightX - 200, y, { width: 200, align: "right" });
  y += 12;

  drawLine(doc, y, true);
  y += 10;

  // ── Table Rows ──
  for (let i = 0; i < invoice.items.length; i++) {
    if (y + 50 > pageBottom) {
      doc.addPage();
      y = MARGIN;
    }

    const item = invoice.items[i];
    const amount = item.quantity * item.rate;

    // Item Name in Bold/Large
    doc.fontSize(13).font("Courier-Bold").text(item.description, MARGIN, y);
    y += 15;

    // Qty x Price
    doc.fontSize(11).font("Courier");
    doc.text(`${item.quantity}(PCS) x ${item.rate.toFixed(2)}`, MARGIN, y);
    
    // Amount
    doc.text(`${amount.toFixed(2)}`, rightX - 100, y, { width: 100, align: "right" });
    y += 15;

    drawLine(doc, y, true);
    y += 8;
  }

  // ── Totals ──
  y += 10;
  const labelX = rightX - 300;
  const valueX = rightX - 120;
  const valueW = 120;

  doc.fontSize(14).font("Courier-Bold");
  
  doc.text("Subtotal:", labelX, y, { width: 170, align: "right" });
  doc.text(fmt(invoice.subtotal), valueX, y, { width: valueW, align: "right" });
  y += 20;

  if (invoice.totalGst > 0) {
    doc.text("GST:", labelX, y, { width: 170, align: "right" });
    doc.text(fmt(invoice.totalGst), valueX, y, { width: valueW, align: "right" });
    y += 20;
  }

  // Total Amount (Larger Font)
  doc.fontSize(16).text("Total Amount:", labelX, y, { width: 170, align: "right" });
  doc.text(fmt(invoice.total), valueX, y, { width: valueW, align: "right" });

  y += 25;
  doc.fontSize(10).font("Courier").text("... THANK YOU ...", MARGIN, y, { 
    align: "center", 
    width: pageWidth 
  });
}

export async function generateInvoicePdf(invoice: Invoice): Promise<Buffer> {
  return docToBuffer((doc) => renderInvoice(doc, invoice));
}

export async function generateBulkInvoicePdf(
  invoices: Invoice[],
): Promise<Buffer> {
  return docToBuffer((doc) => {
    for (let i = 0; i < invoices.length; i++) {
      if (i > 0) doc.addPage();
      renderInvoice(doc, invoices[i]);
    }
  });
}
