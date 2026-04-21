import type { InvoiceItem } from "./types.ts";
import {
  ROW_HEIGHT,
  formatCurrencyPdf as fmt,
  docToBuffer,
} from "./pdfHelpers.ts";

export interface SaleRecord {
  invoiceNumber: string;
  date: string;
  items: InvoiceItem[];
  total: number;
}

export interface PaymentRecord {
  date: string;
  amount: number;
  mode: string | null;
  note: string | null;
}

export interface CustomerReport {
  customerName: string;
  customerPhone?: string;
  customerCity?: string;
  openingBalance: number;
  sales: SaleRecord[];
  payments: PaymentRecord[];
  totalSales: number;
  totalPayments: number;
  closingBalance: number;
}

export interface ReportOptions {
  sellerName: string;
  sellerAddress: string;
  sellerGstin: string;
  sellerPhone: string;
  fromDate: string;
  toDate: string;
  customers: CustomerReport[];
}

const MARGIN = 50;
const ACCENT = "#2c3e50";
const GREEN = "#27ae60";
const LIGHT_BG = "#f8f9fa";
const GREEN_BG = "#f0faf4";
const BORDER = "#dee2e6";

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
  color = BORDER,
  width = 0.5,
) {
  doc
    .moveTo(MARGIN, y)
    .lineTo(getRight(doc), y)
    .lineWidth(width)
    .strokeColor(color)
    .stroke();
  doc.strokeColor("#000000");
}

function checkPage(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed > getBottom(doc)) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function renderReportHeader(
  doc: PDFKit.PDFDocument,
  opts: ReportOptions,
): number {
  const rightX = getRight(doc);
  const pageWidth = getWidth(doc);
  let y = MARGIN;

  // Business name
  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .fillColor(ACCENT)
    .text(opts.sellerName, MARGIN, y, { width: pageWidth * 0.6 });
  y += 22;

  doc.fontSize(8).font("Helvetica").fillColor("#555555");
  if (opts.sellerAddress) {
    doc.text(opts.sellerAddress, MARGIN, y);
    y += 11;
  }
  if (opts.sellerPhone) {
    doc.text(`Ph: ${opts.sellerPhone}`, MARGIN, y);
    y += 11;
  }
  if (opts.sellerGstin) {
    doc.text(`GSTIN: ${opts.sellerGstin}`, MARGIN, y);
    y += 11;
  }

  // Badge — top right
  const badgeW = 160;
  const badgeH = 24;
  const badgeX = rightX - badgeW;
  doc.rect(badgeX, MARGIN, badgeW, badgeH).fill(ACCENT);
  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .fillColor("#ffffff")
    .text("ACCOUNT STATEMENT", badgeX, MARGIN + 6, {
      width: badgeW,
      align: "center",
    });

  // Period — below badge
  doc
    .fillColor("#333333")
    .fontSize(9)
    .font("Helvetica")
    .text(`${opts.fromDate}  to  ${opts.toDate}`, badgeX, MARGIN + 36, {
      width: badgeW,
      align: "right",
    });

  y = Math.max(y, MARGIN + 55) + 8;
  drawLine(doc, y, ACCENT, 1.5);
  y += 20;

  return y;
}

function renderCustomerReport(
  doc: PDFKit.PDFDocument,
  customer: CustomerReport,
  startY: number,
): number {
  const rightX = getRight(doc);
  const pageWidth = getWidth(doc);
  let y = startY;

  // ── Customer Header ──
  y = checkPage(doc, y, 60);

  // Customer name with accent left border
  doc.rect(MARGIN, y, 3, 18).fill(ACCENT);
  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .fillColor("#000000")
    .text(customer.customerName, MARGIN + 10, y + 1);
  y += 20;

  doc.fontSize(8).font("Helvetica").fillColor("#555555");
  if (customer.customerPhone) {
    doc.text(`Ph: ${customer.customerPhone}`, MARGIN + 10, y);
    y += 11;
  }
  if (customer.customerCity) {
    doc.text(customer.customerCity, MARGIN + 10, y);
    y += 11;
  }
  y += 8;

  // ── Opening Balance ──
  doc.rect(MARGIN, y, pageWidth, 22).fill(LIGHT_BG);
  doc
    .fontSize(9)
    .font("Helvetica-Bold")
    .fillColor("#555555")
    .text("Opening Balance", MARGIN + 10, y + 6);
  doc
    .fillColor("#000000")
    .text(fmt(customer.openingBalance), MARGIN, y + 6, {
      width: pageWidth - 10,
      align: "right",
    });
  y += 30;

  // ── Sales Section ──
  if (customer.sales.length > 0) {
    y = checkPage(doc, y, 60);

    doc.fontSize(9).font("Helvetica-Bold").fillColor(ACCENT).text("SALES", MARGIN, y);
    y += 16;

    // Table header
    doc.rect(MARGIN, y, pageWidth, 20).fill(ACCENT);
    doc.fillColor("#ffffff").fontSize(7.5).font("Helvetica-Bold");
    const shy = y + 5;
    doc.text("Date", MARGIN + 8, shy, { width: 70 });
    doc.text("Invoice #", MARGIN + 80, shy, { width: 90 });
    doc.text("Items", MARGIN + 175, shy, { width: 200 });
    doc.text("Amount", MARGIN + 380, shy, { width: pageWidth - 390, align: "right" });
    y += 20;

    doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
    for (let i = 0; i < customer.sales.length; i++) {
      y = checkPage(doc, y, ROW_HEIGHT + 4);
      const sale = customer.sales[i];

      if (i % 2 === 0) {
        doc.rect(MARGIN, y, pageWidth, ROW_HEIGHT + 2).fill(LIGHT_BG);
        doc.fillColor("#000000");
      }

      const itemSummary = sale.items
        .map((it) => `${it.quantity}${it.unit} ${it.description}`)
        .join(", ");

      const ry = y + 3;
      doc.text(sale.date, MARGIN + 8, ry, { width: 70 });
      doc.text(sale.invoiceNumber, MARGIN + 80, ry, { width: 90 });
      doc.text(itemSummary, MARGIN + 175, ry, { width: 200 });
      doc.text(fmt(sale.total), MARGIN + 380, ry, { width: pageWidth - 390, align: "right" });
      y += ROW_HEIGHT + 2;
    }

    drawLine(doc, y);
    y += 6;

    // Total sales
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#000000");
    doc.text("Total Sales", MARGIN + 280, y, { width: 100, align: "right" });
    doc.text(fmt(customer.totalSales), MARGIN + 380, y, {
      width: pageWidth - 390,
      align: "right",
    });
    y += 22;
  }

  // ── Payments Section ──
  if (customer.payments.length > 0) {
    y = checkPage(doc, y, 60);

    doc.fontSize(9).font("Helvetica-Bold").fillColor(GREEN).text("PAYMENTS", MARGIN, y);
    y += 16;

    // Table header
    doc.rect(MARGIN, y, pageWidth, 20).fill(GREEN);
    doc.fillColor("#ffffff").fontSize(7.5).font("Helvetica-Bold");
    const phy = y + 5;
    doc.text("Date", MARGIN + 8, phy, { width: 80 });
    doc.text("Mode", MARGIN + 90, phy, { width: 70 });
    doc.text("Note", MARGIN + 165, phy, { width: 210 });
    doc.text("Amount", MARGIN + 380, phy, { width: pageWidth - 390, align: "right" });
    y += 20;

    doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
    for (let i = 0; i < customer.payments.length; i++) {
      y = checkPage(doc, y, ROW_HEIGHT + 4);
      const pmt = customer.payments[i];

      if (i % 2 === 0) {
        doc.rect(MARGIN, y, pageWidth, ROW_HEIGHT + 2).fill(GREEN_BG);
        doc.fillColor("#000000");
      }

      const ry = y + 3;
      doc.text(pmt.date, MARGIN + 8, ry, { width: 80 });
      doc.text(pmt.mode || "-", MARGIN + 90, ry, { width: 70 });
      doc.text(pmt.note || "-", MARGIN + 165, ry, { width: 210 });
      doc.text(fmt(pmt.amount), MARGIN + 380, ry, { width: pageWidth - 390, align: "right" });
      y += ROW_HEIGHT + 2;
    }

    drawLine(doc, y);
    y += 6;

    // Total payments
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#000000");
    doc.text("Total Payments", MARGIN + 280, y, { width: 100, align: "right" });
    doc.text(fmt(customer.totalPayments), MARGIN + 380, y, {
      width: pageWidth - 390,
      align: "right",
    });
    y += 22;
  }

  // ── Closing Balance ──
  y = checkPage(doc, y, 35);

  const balanceLabel =
    customer.closingBalance > 0
      ? "Balance Due"
      : customer.closingBalance < 0
        ? "Advance"
        : "Settled";

  const balanceColor =
    customer.closingBalance > 0 ? "#e74c3c" : customer.closingBalance < 0 ? GREEN : ACCENT;

  doc.rect(MARGIN, y, pageWidth, 26).fill(balanceColor);
  doc.fontSize(11).font("Helvetica-Bold").fillColor("#ffffff");
  doc.text(balanceLabel, MARGIN + 10, y + 7);
  doc.text(fmt(Math.abs(customer.closingBalance)), MARGIN, y + 7, {
    width: pageWidth - 10,
    align: "right",
  });

  y += 38;
  return y;
}

export async function generateReportPdf(opts: ReportOptions): Promise<Buffer> {
  return docToBuffer((doc) => {
    let y = renderReportHeader(doc, opts);

    for (let i = 0; i < opts.customers.length; i++) {
      if (i > 0) {
        y = checkPage(doc, y, 120);
        // Separator between customers
        drawLine(doc, y, BORDER, 0.5);
        y += 20;
      }
      y = renderCustomerReport(doc, opts.customers[i], y);
    }
  });
}
