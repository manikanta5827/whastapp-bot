# WhatsApp Invoice Bot

A WhatsApp bot for Indian businesses to create GST invoices via natural language. Connects to WhatsApp via Baileys, routes messages through a LangChain ReAct agent backed by OpenAI, which calls an invoice creation tool.

## Architecture

```
src/
  index.ts              ← entry point
  config.ts             ← env config + seller defaults
  whatsapp/
    client.ts           ← Baileys connection, QR auth, message routing
    utils.ts            ← message text extraction helpers
  agent/
    index.ts            ← LangChain ReAct agent setup (OpenAI)
    history.ts          ← per-user in-memory conversation history
  tools/
    invoice.ts          ← LangChain tool: create_invoice (Zod schema)
  invoice/
    types.ts            ← Invoice/InvoiceItem interfaces
    generator.ts        ← invoice number generation + calculations
    formatter.ts        ← WhatsApp-friendly text formatting
    pdf.ts              ← PDF invoice generation (pdfkit)
    pdfStore.ts         ← in-memory buffer store for passing PDFs to sender
```

## Tech Stack

- **Language:** TypeScript (ES modules)
- **Runtime:** Node.js + tsx (for native TS execution)
- **WhatsApp:** `@whiskeysockets/baileys`
- **LLM:** OpenAI via `@langchain/openai`
- **Agent:** LangChain ReAct agent (`@langchain/langgraph`)
- **Tool schemas:** Zod
- **PDF:** pdfkit

## Commands

```bash
npm run dev      # run with watch mode (auto-restart on changes)
npm run start    # run directly
npm install      # install dependencies
```

## Environment

Requires `.env` with `OPENAI_API_KEY`. Optional seller config: `SELLER_NAME`, `SELLER_ADDRESS`, `SELLER_GSTIN`, `SELLER_PHONE`. See `.env.example`.

## Key Design Decisions

- Invoice tool uses Zod schema so the LLM knows exactly what fields to extract
- Per-user conversation history capped at 20 messages in memory
- Invoice formatter outputs WhatsApp-friendly text with bold markers
- PDF invoices generated via pdfkit, passed to WhatsApp sender through an in-memory buffer store (keyed by invoice number, auto-deleted on retrieval)
- GST is per-item (supports mixed rates like 5% on food, 18% on services)
- Auth state stored in `auth_info_baileys/` (gitignored)
