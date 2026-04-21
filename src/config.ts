export const config = {
  openaiApiKey: Bun.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',

  // Conversation history limit per user (human + AI message pairs)
  maxHistory: 20,

  // Default seller info for invoices
  seller: {
    name: Bun.env.SELLER_NAME || 'My Business',
    address: Bun.env.SELLER_ADDRESS || '',
    gstin: Bun.env.SELLER_GSTIN || '',
    phone: Bun.env.SELLER_PHONE || '',
  },
}
