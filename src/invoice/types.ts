export interface InvoiceItem {
  description: string
  quantity: number
  unit: string
  rate: number
  gstPercent: number
}

export interface Invoice {
  invoiceNumber: string
  date: string
  customerName: string
  customerPhone?: string
  sellerName: string
  sellerAddress: string
  sellerGstin: string
  items: InvoiceItem[]
  subtotal: number
  totalGst: number
  total: number
}
