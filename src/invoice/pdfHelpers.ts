import PDFDocument from "pdfkit";

export const LEFT_X = 50;
export const ROW_HEIGHT = 18;

export function formatCurrencyPdf(amount: number): string {
  return (
    "Rs. " +
    amount.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatCurrencyWhatsApp(amount: number): string {
  return (
    "₹" +
    amount.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function getRightX(doc: PDFKit.PDFDocument): number {
  return doc.page.width - 50;
}

export function getPageWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - 100;
}

export function getPageBottom(doc: PDFKit.PDFDocument): number {
  return doc.page.height - 50;
}

/** If y + needed exceeds page bottom, add a new page and return top margin */
export function checkPage(
  doc: PDFKit.PDFDocument,
  y: number,
  needed: number,
): number {
  if (y + needed > getPageBottom(doc)) {
    doc.addPage();
    return 50;
  }
  return y;
}

/** Render pages into a PDFDocument and return as Buffer */
export async function docToBuffer(
  renderFn: (doc: PDFKit.PDFDocument) => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Uint8Array[] = [];

    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    renderFn(doc);
    doc.end();
  });
}
