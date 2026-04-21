import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";
import { extractText, isProtocolMessage } from "./utils.ts";
import { processMessage } from "../agent/index.ts";
import { retrievePdf } from "../invoice/pdfStore.ts";
import logger from "../logger.ts";

const pinoLogger = pino({ level: "silent" });

// Per-user message queue: ensures messages from the same user are processed sequentially
const userQueues = new Map<string, Promise<void>>();

function enqueue(userId: string, fn: () => Promise<void>): void {
  const prev = userQueues.get(userId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  userQueues.set(userId, next);
}

// Track active socket so we can clean up on restart/exit
let activeSock: WASocket | null = null;

function cleanup() {
  if (activeSock) {
    activeSock.end(undefined);
    activeSock = null;
    logger.info("Socket cleaned up");
  }
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", () => {
  cleanup();
  logger.info("Shutting down...");
  process.exit(0);
});

export async function connectToWhatsApp(retryCount = 0): Promise<void> {
  // Close previous socket before creating a new one (prevents 440 overlap)
  cleanup();

  const { version } = await fetchLatestBaileysVersion();
  logger.info("Connecting to WhatsApp...", { version, retryCount });

  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ["Ubuntu", "Chrome", "22.04"],
    logger: pinoLogger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    keepAliveIntervalMs: 30_000,
    connectTimeoutMs: 20_000,
    defaultQueryTimeoutMs: 60_000,
    retryRequestDelayMs: 2_000,
  });

  activeSock = sock;

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info("QR code generated, waiting for scan");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        const nextRetry = retryCount + 1;
        // Longer delay for 440 (connection replaced) to let server settle
        const baseDelay = statusCode === 440 ? 5_000 : 1_000;
        const delay = Math.min(baseDelay * 2 ** retryCount, 30_000);
        logger.warn("Disconnected, reconnecting...", {
          statusCode,
          delay: delay / 1000,
          attempt: nextRetry,
        });
        setTimeout(() => connectToWhatsApp(nextRetry), delay);
      } else {
        logger.error(
          "Logged out. Delete auth_info_baileys/ and restart to re-authenticate.",
        );
      }
    } else if (connection === "open") {
      retryCount = 0;
      logger.info("Connected to WhatsApp");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;
    if (isProtocolMessage(msg.message)) return;

    const text = extractText(msg.message);
    if (!text) return;

    const from = msg.key.remoteJid!;
    const sender = msg.key.participant || from;
    logger.info("Message received", { from, sender, text });

    enqueue(sender, async () => {
      const startTime = Date.now();
      try {
        const reply = await processMessage(sender, text);
        const duration = Date.now() - startTime;

        // Check for PDF keys in the reply (single invoice or bulk report)
        const pdfKeys =
          reply.match(
            /(?:INV-\d{8}-\d{3}|REPORT-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}|BACKUP-[\w-]+-\d+)/g,
          ) || [];
        const pdfs: { key: string; buffer: Buffer }[] = [];
        for (const key of pdfKeys) {
          const buf = retrievePdf(key);
          if (buf) pdfs.push({ key, buffer: buf });
        }

        if (pdfs.length > 0) {
          // Send text first, then each PDF document
          await sock.sendMessage(from, { text: reply }, { quoted: msg });
          logger.info("Reply sent with PDFs", {
            from,
            duration,
            pdfCount: pdfs.length,
          });
          for (const pdf of pdfs) {
            const fileName = `${pdf.key}.pdf`;
            await sock.sendMessage(from, {
              document: pdf.buffer,
              mimetype: "application/pdf",
              fileName,
            });
            logger.info("PDF sent", {
              from,
              key: pdf.key,
              size: pdf.buffer.length,
            });
          }
        } else {
          await sock.sendMessage(from, { text: reply }, { quoted: msg });
          logger.info("Reply sent", {
            from,
            duration,
            reply: reply.substring(0, 200),
          });
        }
      } catch (err) {
        const duration = Date.now() - startTime;
        logger.error("Failed to process message", {
          from: sender,
          error: (err as Error).message,
          duration,
        });
      }
    });
  });
}
