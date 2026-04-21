import { connectToWhatsApp } from "./whatsapp/client.ts";

console.log("Starting WhatsApp Invoice Bot...");
connectToWhatsApp();

process.on("SIGINT", () => {
  console.log("Shutting down...");
  process.exit(0);
});
