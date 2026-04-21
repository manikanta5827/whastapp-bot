interface PdfEntry {
  buffer: Buffer;
  label?: string;
}

const pdfBuffers = new Map<string, PdfEntry>();

export function storePdf(key: string, buffer: Buffer, label?: string): void {
  pdfBuffers.set(key, { buffer, label });
}

export function retrievePdf(key: string): PdfEntry | undefined {
  const entry = pdfBuffers.get(key);
  if (entry) pdfBuffers.delete(key);
  return entry;
}
