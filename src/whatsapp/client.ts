import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import { extractText, isProtocolMessage } from './utils.ts'
import { processMessage } from '../agent/index.ts'
import { retrievePdf } from '../invoice/pdfStore.ts'

const logger = pino({ level: 'silent' })

export async function connectToWhatsApp(retryCount = 0): Promise<void> {
  const { version } = await fetchLatestBaileysVersion()
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['Mac OS', 'Chrome', '14.4.1'],
    logger,
  })

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
        const delay = Math.min(1000 * 2 ** retryCount, 30_000)
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

    try {
      const reply = await processMessage(sender, text)

      const invoiceMatch = reply.match(/INV-\d{8}-\d{3}/)
      const pdfBuffer = invoiceMatch ? retrievePdf(invoiceMatch[0]) : undefined

      if (pdfBuffer) {
        await sock.sendMessage(from, {
          document: pdfBuffer,
          mimetype: 'application/pdf',
          fileName: `${invoiceMatch![0]}.pdf`,
          caption: reply,
        }, { quoted: msg })
        console.log(`[${from}] bot: [sent PDF ${invoiceMatch![0]}]`)
      } else {
        await sock.sendMessage(from, { text: reply }, { quoted: msg })
        console.log(`[${from}] bot: ${reply}`)
      }
    } catch (err) {
      console.error(`Failed to process message from ${sender}:`, (err as Error).message)
    }
  })
}
