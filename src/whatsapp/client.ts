import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import { extractText, isProtocolMessage } from './utils.ts'
import { processMessage } from '../agent/index.ts'
import { retrievePdf } from '../invoice/pdfStore.ts'

const logger = pino({ level: 'silent' })

// Per-user message queue: ensures messages from the same user are processed sequentially
const userQueues = new Map<string, Promise<void>>()

function enqueue(userId: string, fn: () => Promise<void>): void {
  const prev = userQueues.get(userId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  userQueues.set(userId, next)
}

// Track active socket so we can clean up on restart/exit
let activeSock: WASocket | null = null

function cleanup() {
  if (activeSock) {
    activeSock.end(undefined)
    activeSock = null
  }
}

process.on('SIGTERM', cleanup)
process.on('SIGINT', () => {
  cleanup()
  console.log('Shutting down...')
  process.exit(0)
})

export async function connectToWhatsApp(retryCount = 0): Promise<void> {
  // Close previous socket before creating a new one (prevents 440 overlap)
  cleanup()

  const { version } = await fetchLatestBaileysVersion()
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '22.04'],
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    keepAliveIntervalMs: 30_000,
    connectTimeoutMs: 20_000,
    defaultQueryTimeoutMs: 60_000,
    retryRequestDelayMs: 2_000,
  })

  activeSock = sock

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('Scan the QR code to sign in:')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect) {
        const nextRetry = retryCount + 1
        // Longer delay for 440 (connection replaced) to let server settle
        const baseDelay = statusCode === 440 ? 5_000 : 1_000
        const delay = Math.min(baseDelay * 2 ** retryCount, 30_000)
        console.log(`Disconnected (${statusCode}). Reconnecting in ${delay / 1000}s... (attempt ${nextRetry})`)
        setTimeout(() => connectToWhatsApp(nextRetry), delay)
      } else {
        console.log('Logged out. Delete auth_info_baileys/ and restart to re-authenticate.')
      }
    } else if (connection === 'open') {
      retryCount = 0
      console.log('Connected to WhatsApp.')
    }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0]
    if (!msg.message || msg.key.fromMe) return
    if (isProtocolMessage(msg.message)) return

    const text = extractText(msg.message)
    if (!text) return

    const from = msg.key.remoteJid!
    const sender = msg.key.participant || from
    console.log(`[${from}] ${sender}: ${text}`)

    enqueue(sender, async () => {
      try {
        const reply = await processMessage(sender, text)

        // Find all invoice numbers in the reply (supports bulk report)
        const invoiceMatches = reply.match(/INV-\d{8}-\d{3}/g) || []
        const pdfs: { number: string; buffer: Buffer }[] = []
        for (const invNum of invoiceMatches) {
          const buf = retrievePdf(invNum)
          if (buf) pdfs.push({ number: invNum, buffer: buf })
        }

        if (pdfs.length === 1) {
          // Single invoice — send as document with caption
          await sock.sendMessage(from, {
            document: pdfs[0].buffer,
            mimetype: 'application/pdf',
            fileName: `${pdfs[0].number}.pdf`,
            caption: reply,
          }, { quoted: msg })
          console.log(`[${from}] bot: [sent PDF ${pdfs[0].number}]`)
        } else if (pdfs.length > 1) {
          // Bulk — send text first, then each PDF
          await sock.sendMessage(from, { text: reply }, { quoted: msg })
          for (const pdf of pdfs) {
            await sock.sendMessage(from, {
              document: pdf.buffer,
              mimetype: 'application/pdf',
              fileName: `${pdf.number}.pdf`,
            })
            console.log(`[${from}] bot: [sent PDF ${pdf.number}]`)
          }
        } else {
          await sock.sendMessage(from, { text: reply }, { quoted: msg })
          console.log(`[${from}] bot: ${reply}`)
        }
      } catch (err) {
        console.error(`Failed to process message from ${sender}:`, (err as Error).message)
      }
    })
  })
}
