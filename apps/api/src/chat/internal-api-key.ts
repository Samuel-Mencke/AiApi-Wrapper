import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema.js";
import { env } from "../env.js";
import { hashApiKey } from "../middleware/auth.js";

export const CHAT_API_KEY_ID = "system";
export const CHAT_API_KEY_NAME = "Dashboard Chat";

export function ensureInternalChatApiKey(): boolean {
  const existing = db.select().from(apiKeys).where(eq(apiKeys.id, CHAT_API_KEY_ID)).get();
  const now = new Date().toISOString();

  if (!existing) {
    db.insert(apiKeys).values({
      id: CHAT_API_KEY_ID,
      name: CHAT_API_KEY_NAME,
      keyHash: hashApiKey(env.GATEWAY_MASTER_KEY),
      enabled: true,
      createdAt: now,
      lastUsedAt: null
    }).run();
    return true;
  }

  if (existing.name !== CHAT_API_KEY_NAME || !existing.enabled) {
    db.update(apiKeys)
      .set({
        name: CHAT_API_KEY_NAME,
        enabled: true
      })
      .where(eq(apiKeys.id, CHAT_API_KEY_ID))
      .run();
  }

  return false;
}
