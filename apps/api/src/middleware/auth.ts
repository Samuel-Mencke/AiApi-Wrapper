import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gte } from "drizzle-orm";
import { GatewayError } from "@ai-gateway/core/errors";
import { db } from "../db/client.js";
import { apiKeys, requests } from "../db/schema.js";
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

const SESSION_COOKIE = "ai_gateway_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const FALLBACK_ADMIN_PASSWORD_HASH =
  "pbkdf2_sha256$210000$3f092f0bfd2352aa8d7e560e3a87eef9$c2ef61a14251c8e9799dc1843db42efaa065444dea51ac9bc3bc2f6ab29b8da0";

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
}

function cookieValue(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signSession(payload: string): string {
  return crypto.createHmac("sha256", env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyAdminPassword(password: string): boolean {
  const encoded = env.ADMIN_PASSWORD_HASH ?? FALLBACK_ADMIN_PASSWORD_HASH;
  const [scheme, iterationsValue, salt, expected] = encoded.split("$");
  if (scheme !== "pbkdf2_sha256" || !iterationsValue || !salt || !expected) return false;
  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;
  const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  return timingSafeEqual(actual, expected);
}

function startOfCurrentMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function secondsUntilNextMonth(): number {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.max(1, Math.ceil((nextMonth.getTime() - Date.now()) / 1000));
}

export function setAdminSession(reply: FastifyReply): void {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = base64Url(JSON.stringify({ sub: env.ADMIN_USERNAME, exp: expiresAt }));
  const token = `${payload}.${signSession(payload)}`;
  const secure = env.PUBLIC_BASE_URL.startsWith("https://");
  const domain = new URL(env.PUBLIC_BASE_URL).hostname.endsWith("samuelm.de") ? "; Domain=.samuelm.de" : "";
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${
      secure ? "; Secure" : ""
    }${domain}`
  );
}

export function clearAdminSession(reply: FastifyReply): void {
  const secure = env.PUBLIC_BASE_URL.startsWith("https://");
  const domain = new URL(env.PUBLIC_BASE_URL).hostname.endsWith("samuelm.de") ? "; Domain=.samuelm.de" : "";
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}${domain}`
  );
}

export function hasValidAdminSession(request: FastifyRequest): boolean {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !timingSafeEqual(signature, signSession(payload))) return false;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
    return body.sub === env.ADMIN_USERNAME && typeof body.exp === "number" && body.exp > Date.now();
  } catch {
    return false;
  }
}

export async function requireApiAuth(request: FastifyRequest): Promise<void> {
  const token = bearerToken(request);
  if (!token) {
    throw new GatewayError("API key required", {
      code: "api_key_required",
      statusCode: 401
    });
  }

  if (token === env.GATEWAY_MASTER_KEY) {
    request.auth = { apiKeyId: null, isAdmin: true };
    return;
  }

  const key = db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashApiKey(token))).get();
  if (!key || !key.enabled) {
    throw new GatewayError("Invalid or disabled API key", {
      code: "invalid_api_key",
      statusCode: 401
    });
  }

  if (key.monthlyLimit !== null && key.monthlyLimit !== undefined) {
    const usedThisMonth = db.select()
      .from(requests)
      .where(and(eq(requests.apiKeyId, key.id), gte(requests.createdAt, startOfCurrentMonth())))
      .all().length;

    if (usedThisMonth >= key.monthlyLimit) {
      throw new GatewayError("Monthly API key request limit exceeded", {
        code: "rate_limit_exceeded",
        statusCode: 429,
        retryAfter: secondsUntilNextMonth()
      });
    }
  }

  db.update(apiKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiKeys.id, key.id)).run();
  request.auth = { apiKeyId: key.id, isAdmin: false };
}

export async function requireAdminAuth(request: FastifyRequest): Promise<void> {
  if (!hasValidAdminSession(request)) {
    throw new GatewayError("Admin login required", {
      code: "admin_login_required",
      statusCode: 401
    });
  }
  request.auth = { apiKeyId: null, isAdmin: true };
}
