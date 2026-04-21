import type { proto } from '@whiskeysockets/baileys'

export function extractText(message: proto.IMessage): string | null {
  return (
    message.conversation
    || message.extendedTextMessage?.text
    || message.imageMessage?.caption
    || message.videoMessage?.caption
    || null
  )
}

export function isProtocolMessage(message: proto.IMessage): boolean {
  return !!(message.protocolMessage || message.senderKeyDistributionMessage)
}
