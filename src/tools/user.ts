import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { users } from "../db/schema.ts";
import logger from "../logger.ts";

export const registerUserTool = tool(
  async (input) => {
    logger.info("register_user called", { userId: input.userId, businessName: input.businessName, proprietorName: input.proprietorName });
    db.update(users)
      .set({
        businessName: input.businessName,
        address: input.address,
        gstin: input.gstin,
        proprietorName: input.proprietorName,
        businessPhone: input.businessPhone,
      })
      .where(eq(users.id, input.userId))
      .run();

    logger.info("User registered successfully", { userId: input.userId });
    return `Business registered: ${input.businessName} (${input.proprietorName}), Phone: ${input.businessPhone}. You can now create customers and invoices!`;
  },
  {
    name: "register_user",
    description: `Register the user's business details. Call this after collecting all required details.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      businessName: z.string().describe("Name of the business"),
      address: z.string().describe("Business address"),
      proprietorName: z.string().describe("Owner/proprietor name"),
      businessPhone: z.string().describe("Business phone number (printed on invoices)"),
      gstin: z.string().optional().describe("GST Identification Number"),
    }),
  },
);

export const setLanguageTool = tool(
  async (input) => {
    logger.info("set_language called", { userId: input.userId, language: input.language });
    db.update(users)
      .set({ language: input.language })
      .where(eq(users.id, input.userId))
      .run();

    return `Language preference set to ${input.language}.`;
  },
  {
    name: "set_language",
    description: `Set the user's preferred language.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      language: z
        .string()
        .describe('e.g. "english", "hindi", "telugu", "kannada", "tamil"'),
    }),
  },
);

export const updateUserTool = tool(
  async (input) => {
    logger.info("update_user called", { userId: input.userId });
    const user = db.select().from(users).where(eq(users.id, input.userId)).get();
    if (!user) return "User not found.";

    db.update(users)
      .set({
        ...(input.businessName && { businessName: input.businessName }),
        ...(input.address && { address: input.address }),
        ...(input.proprietorName && { proprietorName: input.proprietorName }),
        ...(input.businessPhone && { businessPhone: input.businessPhone }),
        ...(input.gstin && { gstin: input.gstin }),
        ...(input.language && { language: input.language }),
      })
      .where(eq(users.id, input.userId))
      .run();

    const updated = db.select().from(users).where(eq(users.id, input.userId)).get()!;
    return `Business details updated:\n• Name: ${updated.businessName}\n• Address: ${updated.address}\n• Owner: ${updated.proprietorName}\n• Phone: ${updated.businessPhone}\n• GSTIN: ${updated.gstin || "N/A"}\n• Language: ${updated.language}`;
  },
  {
    name: "update_user",
    description: `Update the user's business details. Call this AFTER the user confirms the changes. Show what will change and ask for confirmation first.`,
    schema: z.object({
      userId: z.number().describe("User ID from context"),
      businessName: z.string().optional().describe("Updated business name"),
      address: z.string().optional().describe("Updated address"),
      proprietorName: z.string().optional().describe("Updated owner name"),
      businessPhone: z.string().optional().describe("Updated business phone"),
      gstin: z.string().optional().describe("Updated GSTIN"),
      language: z.string().optional().describe("Updated language"),
    }),
  },
);
