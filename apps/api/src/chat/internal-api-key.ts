import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema.js";
import { hashApiKey } from "../middleware/auth.js";

export const CHAT_API_KEY_ID = "system";
export const CHAT_API_KEY_NAME = "Dashboard Chat";

/**
 * The internal chat key is a self-contained secret generated on first run
 * and stored as a hash in the api_keys table (id="system"). It is NOT
 * derived from MASTER_API_KEY, so the dashboard chat works independently.
 */
export function getInternalChatApiKey(): string {
  const cached = (globalThis as Record<string, unknown>).__internalChatKey as string | undefined;
  if (cached) return cached;

  const key = `gw_${crypto.randomBytes(24).toString("base64url")}`;
  const keyHash = hashApiKey(key);
  const now = new Date().toISOString();

  const existing = db.select().from(apiKeys).where(eq(apiKeys.id, CHAT_API_KEY_ID)).get();
  if (!existing) {
    db.insert(apiKeys).values({
      id: CHAT_API_KEY_ID,
      name: CHAT_API_KEY_NAME,
      keyHash,
      enabled: true,
      createdAt: now,
      lastUsedAt: null
    }).run();
  } else {
    db.update(apiKeys)
      .set({ name: CHAT_API_KEY_NAME, keyHash, enabled: true })
      .where(eq(apiKeys.id, CHAT_API_KEY_ID))
      .run();
  }

  (globalThis as Record<string, unknown>).__internalChatKey = key;
  return key;
}

export function ensureInternalChatApiKey(): boolean {
  getInternalChatApiKey();
  return true;
}
