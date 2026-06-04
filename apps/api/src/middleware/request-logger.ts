import { nanoid } from "nanoid";
import { db } from "../db/client.js";
import { requests } from "../db/schema.js";

export interface RequestLogInput {
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

export function logRequest(input: RequestLogInput): void {
  db.insert(requests).values({
    id: nanoid(),
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
}
