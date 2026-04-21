const pdfBuffers = new Map<string, Buffer>();

export function storePdf(invoiceNumber: string, buffer: Buffer): void {
  pdfBuffers.set(invoiceNumber, buffer);
}

export function retrievePdf(invoiceNumber: string): Buffer | undefined {
  const buf = pdfBuffers.get(invoiceNumber);
  if (buf) pdfBuffers.delete(invoiceNumber);
  return buf;
}
