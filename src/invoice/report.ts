import PDFDocument from "pdfkit";
import type { InvoiceItem } from "./types.ts";

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
const ROW_HEIGHT = 16;

function getRightX(doc: PDFKit.PDFDocument): number {
  return doc.page.width - 50;
}

function getPageWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - 100;
}

function getPageBottom(doc: PDFKit.PDFDocument): number {
  return doc.page.height - 50;
}

function checkPage(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed > getPageBottom(doc)) {
    doc.addPage();
    return 50;
  }
  return y;
}

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

function renderCustomerReport(
  doc: PDFKit.PDFDocument,
  customer: CustomerReport,
  opts: ReportOptions,
  isFirst: boolean,
): void {
  const rightX = getRightX(doc);
  const pageWidth = getPageWidth(doc);
  let y = 50;

  // --- Header (only on first page of entire report) ---
  if (isFirst) {
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("ACCOUNT STATEMENT", LEFT_X, y, { align: "center" });
    y += 24;

    doc.fontSize(9).font("Helvetica");
    doc.text(`${opts.sellerName} | ${opts.sellerAddress}`, LEFT_X, y, {
      align: "center",
    });
    y += 13;
    if (opts.sellerGstin) {
      doc.text(`GSTIN: ${opts.sellerGstin} | Phone: ${opts.sellerPhone}`, LEFT_X, y, {
        align: "center",
      });
      y += 13;
    }
    doc.text(`Period: ${opts.fromDate} to ${opts.toDate}`, LEFT_X, y, {
      align: "center",
    });
    y += 18;

    doc
      .moveTo(LEFT_X, y)
      .lineTo(rightX, y)
      .lineWidth(2)
      .stroke();
    y += 15;
  }

  // --- Customer Header ---
  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .text(customer.customerName, LEFT_X, y);
  y += 16;

  doc.fontSize(9).font("Helvetica");
  if (customer.customerPhone) {
    doc.text(`Phone: ${customer.customerPhone}`, LEFT_X, y);
    y += 12;
  }
  if (customer.customerCity) {
    doc.text(customer.customerCity, LEFT_X, y);
    y += 12;
  }
  y += 5;

  // --- Opening Balance ---
  doc
    .moveTo(LEFT_X, y)
    .lineTo(rightX, y)
    .lineWidth(0.5)
    .stroke();
  y += 8;

  doc
    .fontSize(10)
    .font("Helvetica-Bold")
    .text("Opening Balance:", LEFT_X, y, { continued: true })
    .font("Helvetica")
    .text(`  ${formatCurrency(customer.openingBalance)}`, { align: "right" });
  y += 18;

  // --- Sales Section ---
  if (customer.sales.length > 0) {
    y = checkPage(doc, y, 50);
    doc.fontSize(11).font("Helvetica-Bold").text("Sales", LEFT_X, y);
    y += 16;

    // Sales table header
    doc.rect(LEFT_X, y, pageWidth, 18).fill("#f0f0f0");
    doc.fillColor("#000000").fontSize(8).font("Helvetica-Bold");
    y += 4;
    doc.text("Date", LEFT_X + 5, y, { width: 75 });
    doc.text("Invoice #", LEFT_X + 80, y, { width: 100 });
    doc.text("Items", LEFT_X + 180, y, { width: 180 });
    doc.text("Amount", LEFT_X + 370, y, { width: 75, align: "right" });
    y += 18;

    doc.font("Helvetica").fontSize(8);
    for (const sale of customer.sales) {
      y = checkPage(doc, y, ROW_HEIGHT);

      const itemSummary = sale.items
        .map((i) => `${i.quantity}${i.unit} ${i.description}`)
        .join(", ");

      doc.text(sale.date, LEFT_X + 5, y, { width: 75 });
      doc.text(sale.invoiceNumber, LEFT_X + 80, y, { width: 100 });
      doc.text(itemSummary, LEFT_X + 180, y, { width: 180 });
      doc.text(formatCurrency(sale.total), LEFT_X + 370, y, {
        width: 75,
        align: "right",
      });
      y += ROW_HEIGHT;
    }

    y += 4;
    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("Total Sales:", LEFT_X + 280, y, { width: 90, align: "right" });
    doc.text(formatCurrency(customer.totalSales), LEFT_X + 370, y, {
      width: 75,
      align: "right",
    });
    y += 18;
  }

  // --- Payments Section ---
  if (customer.payments.length > 0) {
    y = checkPage(doc, y, 50);
    doc.fontSize(11).font("Helvetica-Bold").text("Payments", LEFT_X, y);
    y += 16;

    // Payments table header
    doc.rect(LEFT_X, y, pageWidth, 18).fill("#e8f5e9");
    doc.fillColor("#000000").fontSize(8).font("Helvetica-Bold");
    y += 4;
    doc.text("Date", LEFT_X + 5, y, { width: 80 });
    doc.text("Mode", LEFT_X + 90, y, { width: 80 });
    doc.text("Note", LEFT_X + 180, y, { width: 180 });
    doc.text("Amount", LEFT_X + 370, y, { width: 75, align: "right" });
    y += 18;

    doc.font("Helvetica").fontSize(8);
    for (const pmt of customer.payments) {
      y = checkPage(doc, y, ROW_HEIGHT);

      doc.text(pmt.date, LEFT_X + 5, y, { width: 80 });
      doc.text(pmt.mode || "-", LEFT_X + 90, y, { width: 80 });
      doc.text(pmt.note || "-", LEFT_X + 180, y, { width: 180 });
      doc.text(formatCurrency(pmt.amount), LEFT_X + 370, y, {
        width: 75,
        align: "right",
      });
      y += ROW_HEIGHT;
    }

    y += 4;
    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("Total Payments:", LEFT_X + 280, y, {
      width: 90,
      align: "right",
    });
    doc.text(formatCurrency(customer.totalPayments), LEFT_X + 370, y, {
      width: 75,
      align: "right",
    });
    y += 18;
  }

  // --- Closing Balance ---
  y = checkPage(doc, y, 40);
  doc
    .moveTo(LEFT_X, y)
    .lineTo(rightX, y)
    .lineWidth(1)
    .stroke();
  y += 10;

  doc.fontSize(12).font("Helvetica-Bold");
  const balanceLabel =
    customer.closingBalance > 0
      ? "Balance Due"
      : customer.closingBalance < 0
        ? "Advance"
        : "Settled";
  doc.text(`${balanceLabel}:`, LEFT_X + 280, y, {
    width: 90,
    align: "right",
  });
  doc.text(
    formatCurrency(Math.abs(customer.closingBalance)),
    LEFT_X + 370,
    y,
    { width: 75, align: "right" },
  );
}

export async function generateReportPdf(
  opts: ReportOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Uint8Array[] = [];

    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    for (let i = 0; i < opts.customers.length; i++) {
      if (i > 0) doc.addPage();
      renderCustomerReport(doc, opts.customers[i], opts, i === 0);
    }

    doc.end();
  });
}
