import type { ModelRouteTarget } from "@ai-gateway/core";
import { GatewayError } from "@ai-gateway/core/errors";
import { sqlite } from "../db/client.js";

const PROVIDER_QUOTA_ALIAS = "__provider__";

// ── In-memory quota cache ──
interface CachedQuotaSettings {
  provider: string;
  modelAlias: string;
  enabled: boolean;
  windowHours: number;
  requestLimit: number | null;
  tokenLimit: number | null;
  concurrencyLimit: number | null;
}
let quotaCache: CachedQuotaSettings[] | null = null;

export function invalidateQuotaCache(): void {
  quotaCache = null;
}

function loadQuotaCache(): CachedQuotaSettings[] {
  if (quotaCache) return quotaCache;
  quotaCache = sqlite.prepare(
    `SELECT provider, model_alias, enabled, window_hours, request_limit, token_limit, concurrency_limit FROM quota_settings`
  ).all() as CachedQuotaSettings[];
  return quotaCache;
}

function retryAfterSeconds(windowHours: number): number {
  // Conservative estimate — just return the window
  return Math.max(1, Math.ceil(windowHours * 60 * 60));
}

export function enforceRouteQuota(modelAlias: string, target: ModelRouteTarget): void {
  const allSettings = loadQuotaCache();
  const providerSetting = allSettings.find(
    (s) => s.enabled && s.provider === target.provider && s.modelAlias === PROVIDER_QUOTA_ALIAS
  );
  const modelSetting = allSettings.find(
    (s) => s.enabled && s.provider === target.provider && s.modelAlias === modelAlias
  );
  const setting = providerSetting ?? modelSetting;

  if (!setting) {
    return;
  }

  const windowStart = new Date(Date.now() - setting.windowHours * 60 * 60 * 1000).toISOString();

  // Use SQL COUNT + SUM instead of loading all rows into JS
  if (setting.modelAlias === PROVIDER_QUOTA_ALIAS) {
    // Provider-level quota — match only on provider
    if (setting.requestLimit !== null) {
      const row = sqlite.prepare(
        "SELECT COUNT(*) as cnt FROM requests WHERE provider = ? AND created_at >= ?"
      ).get(target.provider, windowStart) as { cnt: number };
      if (row.cnt >= setting.requestLimit) {
        throw new GatewayError("Configured gateway request quota exceeded", {
          code: "rate_limit_exceeded",
          statusCode: 429,
          retryAfter: retryAfterSeconds(setting.windowHours)
        });
      }
    }

    if (setting.tokenLimit !== null) {
      const row = sqlite.prepare(
        "SELECT COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)),0) as total FROM requests WHERE provider = ? AND created_at >= ?"
      ).get(target.provider, windowStart) as { total: number };
      if (row.total >= setting.tokenLimit) {
        throw new GatewayError("Configured gateway token quota exceeded", {
          code: "rate_limit_exceeded",
          statusCode: 429,
          retryAfter: retryAfterSeconds(setting.windowHours)
        });
      }
    }
  } else {
    // Model-level quota — match on provider + model_alias
    if (setting.requestLimit !== null) {
      const row = sqlite.prepare(
        "SELECT COUNT(*) as cnt FROM requests WHERE provider = ? AND model_alias = ? AND created_at >= ?"
      ).get(target.provider, modelAlias, windowStart) as { cnt: number };
      if (row.cnt >= setting.requestLimit) {
        throw new GatewayError("Configured gateway request quota exceeded", {
          code: "rate_limit_exceeded",
          statusCode: 429,
          retryAfter: retryAfterSeconds(setting.windowHours)
        });
      }
    }

    if (setting.tokenLimit !== null) {
      const row = sqlite.prepare(
        "SELECT COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)),0) as total FROM requests WHERE provider = ? AND model_alias = ? AND created_at >= ?"
      ).get(target.provider, modelAlias, windowStart) as { total: number };
      if (row.total >= setting.tokenLimit) {
        throw new GatewayError("Configured gateway token quota exceeded", {
          code: "rate_limit_exceeded",
          statusCode: 429,
          retryAfter: retryAfterSeconds(setting.windowHours)
        });
      }
    }
  }
}
