import { nanoid } from "nanoid";
import { db } from "../db/client.js";
import { requests } from "../db/schema.js";

export interface RequestLogInput {
  requestId?: string;
  apiKeyId: string | null;
  modelAlias: string;
  provider: string;
  realModel: string;
  status: "success" | "error";
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number | null;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Batch-queue for request logging.
 * Instead of blocking every API request with a synchronous SQLite INSERT,
 * we batch up to 50 entries (or flush every 2s) and write them in a single transaction.
 */
const flushInterval = 2_000;
const maxBatchSize = 50;
let pendingQueue: Array<() => void> = [];
let flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const batch = pendingQueue;
    pendingQueue = [];
    if (batch.length > 0) {
      setImmediate(() => batch.forEach((fn) => fn()));
    }
  }, flushInterval);
}

function flushNow(): void {
  const batch = pendingQueue;
  pendingQueue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (batch.length === 0) return;
  batch.forEach((fn) => fn());
}

export function logRequest(input: RequestLogInput): void {
  // Create the insert closure but defer execution
  const insertFn = () => {
    try {
      db.insert(requests).values({
        id: nanoid(),
        requestId: input.requestId,
        apiKeyId: input.apiKeyId,
        modelAlias: input.modelAlias,
        provider: input.provider,
        realModel: input.realModel,
        status: input.status,
        latencyMs: input.latencyMs,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimatedCost: input.estimatedCost ?? undefined,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        createdAt: new Date().toISOString()
      }).run();
    } catch {
      // Swallow DB errors in async logging — never crash the API for logging
    }
  };

  pendingQueue.push(insertFn);

  if (pendingQueue.length >= maxBatchSize) {
    flushNow();
  } else {
    scheduleFlush();
  }
}

/**
 * Ensure all pending logs are written before process exit.
 */
export function drainLogQueue(): void {
  flushNow();
}
