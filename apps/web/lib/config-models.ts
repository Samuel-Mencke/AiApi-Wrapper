import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface ConfigChatModel {
  alias: string;
  provider: string;
  realModel: string;
  fallbackCount: number;
  status: "untested";
  statusMessage: string;
  latencyMs: null;
  modelCapabilities: {
    supportsReasoning: boolean;
    exposesReasoningSummary: boolean;
    supportsTools: boolean;
    supportsRichBlocks: boolean;
  };
}

interface ProvidersFile {
  providers?: Record<string, {
    type?: string;
    enabled?: boolean;
  }>;
  models?: Record<string, {
    provider?: string;
    model?: string;
    enabled?: boolean;
    fallback?: unknown[];
  }>;
}

function readRootEnv() {
  const envPath = path.resolve(process.cwd(), "../../.env");
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs.readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key, rest.join("=").replace(/^["']|["']$/g, "")];
      })
  ) as Record<string, string>;
}

function providerHasKey(providerName: string, providerType: string | undefined, values: Record<string, string>) {
  const keyByProvider: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    gemini: "GEMINI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    "z-ai": "ZAI_API_KEY"
  };
  const envKey = keyByProvider[providerName] ?? keyByProvider[providerType ?? ""];
  return Boolean(envKey && values[envKey]?.trim());
}

export function getConfigChatModels(): ConfigChatModel[] {
  const configPath = path.resolve(process.cwd(), "../../config/providers.yml");
  if (!fs.existsSync(configPath)) return [];
  const parsed = (YAML.parse(fs.readFileSync(configPath, "utf8")) ?? {}) as ProvidersFile;
  const envValues = readRootEnv();
  return Object.entries(parsed.models ?? {})
    .filter(([, model]) => {
      if (model.enabled === false || !model.provider || !model.model) return false;
      const provider = parsed.providers?.[model.provider];
      if (!provider || provider.enabled === false) return false;
      return providerHasKey(model.provider, provider.type, envValues);
    })
    .map(([alias, model]) => ({
      alias,
      provider: model.provider!,
      realModel: model.model!,
      fallbackCount: Array.isArray(model.fallback) ? model.fallback.length : 0,
      status: "untested",
      statusMessage: "Loaded from provider config",
      latencyMs: null,
      modelCapabilities: {
        supportsReasoning: false,
        exposesReasoningSummary: false,
        supportsTools: true,
        supportsRichBlocks: false
      }
    }));
}
