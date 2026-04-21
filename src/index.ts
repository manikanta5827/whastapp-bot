import { connectToWhatsApp } from "./whatsapp/client.ts";
import logger from "./logger.ts";

logger.info("Starting WhatsApp Invoice Bot...");
connectToWhatsApp();
