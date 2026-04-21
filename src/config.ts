import "dotenv/config";

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',

  // Conversation history limit per user (human + AI message pairs)
  maxHistory: 20,

  // Default seller info for invoices
  seller: {
    name: process.env.SELLER_NAME || 'JJ Vegetables',
    address: process.env.SELLER_ADDRESS || 'Hyderabad',
    gstin: process.env.SELLER_GSTIN || '36AAAAA0000A1Z5',
    phone: process.env.SELLER_PHONE || '9876543210',
  },
}
