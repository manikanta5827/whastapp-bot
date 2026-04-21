# WhatsApp Invoice Bot

A WhatsApp bot for Indian businesses to create GST invoices via natural language. Connects to WhatsApp via Baileys, routes messages through a LangChain ReAct agent backed by OpenAI, which calls tools for user registration, customer management, invoice creation, and sale tracking.

## Architecture

```
src/
  index.ts              ← entry point
  config.ts             ← env config (API key, model, history limit)
  db/
    schema.ts           ← Drizzle ORM schema (users, customers, sales, messages)
    index.ts            ← DB connection + auto-migration
  whatsapp/
    client.ts           ← Baileys connection, QR auth, per-user message queue
    utils.ts            ← message text extraction helpers
  agent/
    index.ts            ← LangChain ReAct agent setup, user context injection
    history.ts          ← per-user conversation history (SQLite via Drizzle)
  tools/
    user.ts             ← register_user, set_language tools
    customer.ts         ← create_customers, update_customer, delete_customer, search_customers tools
    invoice.ts          ← create_invoice, confirm_invoice, get_sales, generate_sale_report tools
  invoice/
    types.ts            ← Invoice/InvoiceItem interfaces
    generator.ts        ← invoice number generation + calculations
    formatter.ts        ← WhatsApp-friendly text formatting
    pdf.ts              ← PDF invoice generation (pdfkit)
    pdfStore.ts         ← in-memory buffer store for passing PDFs to sender
    pendingStore.ts     ← pending invoices awaiting user confirmation
drizzle/                ← SQL migration files (auto-run on startup)
drizzle.config.ts       ← Drizzle Kit config
```

## Tech Stack

- **Language:** TypeScript (ES modules)
- **Runtime:** Node.js + tsx (for native TS execution)
- **WhatsApp:** `@whiskeysockets/baileys`
- **LLM:** OpenAI via `@langchain/openai`
- **Agent:** LangChain ReAct agent (`@langchain/langgraph`)
- **Database:** SQLite via `better-sqlite3` + `drizzle-orm`
- **Tool schemas:** Zod
- **PDF:** pdfkit

## Commands

```bash
npm run dev                # run with watch mode (auto-restart on changes)
npm run start              # run directly
npm install                # install dependencies
npx drizzle-kit generate   # generate migration after schema changes
npx drizzle-kit studio     # browser UI to inspect database
```

## Environment

Requires `.env` with `OPENAI_API_KEY`. Seller info is now per-user (stored in DB during onboarding).

## Key Design Decisions

- 10 LangChain tools with Zod schemas — LLM manages all DB operations, no direct DB calls from message handler
- New user onboarding: language preference → business registration (all via LLM tools)
- Customer disambiguation: search by name → exact match auto-selects, multiple matches prompt clarification, no match offers creation
- Invoice confirmation flow: create preview → user confirms → PDF generated + sale recorded
- Per-user message queue prevents race conditions on concurrent messages from same user
- Conversation history persisted in SQLite (survives restarts)
- sale records enable sales queries and bulk invoice regeneration by date range
- PDF buffers passed from tools to WhatsApp sender via in-memory store (auto-deleted on retrieval)
- GST is per-item (supports mixed rates like 5% on food, 18% on services)
- Auth state stored in `auth_info_baileys/` (gitignored)
- Database stored in `bot.db` (gitignored)
