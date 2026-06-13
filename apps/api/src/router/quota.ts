import type { ModelRouteTarget } from "@ai-gateway/core";
import { GatewayError } from "@ai-gateway/core/errors";
import { db } from "../db/client.js";
import { quotaSettings, requests } from "../db/schema.js";

const PROVIDER_QUOTA_ALIAS = "__provider__";

function retryAfterSeconds(windowHours: number, matchingRequests: Array<typeof requests.$inferSelect>): number {
  const oldest = matchingRequests
    .map((request) => new Date(request.createdAt).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0];

  if (!oldest) {
    return Math.max(1, Math.ceil(windowHours * 60 * 60));
  }

  const resetAt = oldest + windowHours * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}

export function enforceRouteQuota(modelAlias: string, target: ModelRouteTarget): void {
  const allSettings = db.select().from(quotaSettings).all();
  const providerSetting = allSettings.find(
    (setting) => setting.enabled && setting.provider === target.provider && setting.modelAlias === PROVIDER_QUOTA_ALIAS
  );
  const modelSetting = allSettings.find(
    (setting) => setting.enabled && setting.provider === target.provider && setting.modelAlias === modelAlias
  );
  const setting = providerSetting ?? modelSetting;

  if (!setting) {
    return;
  }

  const windowStart = new Date(Date.now() - setting.windowHours * 60 * 60 * 1000).toISOString();
  const matchingRequests = db.select().from(requests).all().filter((request) =>
    request.createdAt >= windowStart &&
    request.provider === target.provider &&
    (setting.modelAlias === PROVIDER_QUOTA_ALIAS || request.modelAlias === modelAlias)
  );
  const usedTokens = matchingRequests.reduce(
    (total, request) => total + (request.inputTokens ?? 0) + (request.outputTokens ?? 0),
    0
  );

  if (setting.requestLimit !== null && matchingRequests.length >= setting.requestLimit) {
    throw new GatewayError("Configured gateway request quota exceeded", {
      code: "rate_limit_exceeded",
      statusCode: 429,
      retryAfter: retryAfterSeconds(setting.windowHours, matchingRequests)
    });
  }

  if (setting.tokenLimit !== null && usedTokens >= setting.tokenLimit) {
    throw new GatewayError("Configured gateway token quota exceeded", {
      code: "rate_limit_exceeded",
      statusCode: 429,
      retryAfter: retryAfterSeconds(setting.windowHours, matchingRequests)
    });
  }
}
