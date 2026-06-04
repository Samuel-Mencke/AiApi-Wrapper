import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema.js";
import { env } from "../env.js";

export interface AuthContext {
  apiKeyId: string | null;
  isAdmin: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
}

export async function requireApiAuth(request: FastifyRequest): Promise<void> {
  const token = bearerToken(request);
  if (!token) {
    request.auth = { apiKeyId: null, isAdmin: false };
    return;
  }

  if (token === env.GATEWAY_MASTER_KEY) {
    request.auth = { apiKeyId: null, isAdmin: true };
    return;
  }

  const key = db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashApiKey(token))).get();
  if (!key || !key.enabled) {
    request.auth = { apiKeyId: null, isAdmin: false };
    return;
  }

  db.update(apiKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiKeys.id, key.id)).run();
  request.auth = { apiKeyId: key.id, isAdmin: false };
}

export async function requireAdminAuth(request: FastifyRequest): Promise<void> {
  request.auth = { apiKeyId: null, isAdmin: true };
}
