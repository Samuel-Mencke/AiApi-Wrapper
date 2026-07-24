import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "../../..");

dotenv.config({ path: path.resolve(root, ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional()
);

const requiredSecret = (label: string, minimumLength = 32) =>
  z
    .string({ required_error: `${label} is required` })
    .min(minimumLength, `${label} must contain at least ${minimumLength} characters`)
    .refine(
      (value) => !/(change[-_ ]?me|replace[-_ ]?me|generate|example|placeholder)/i.test(value),
      `${label} still contains a placeholder value`
    );

const schema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(18789),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:18789"),
  SERVICE_NAME: z.string().min(1).default("model-api"),
  DASHBOARD_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().default("file:./gateway.db"),
  UPLOAD_DIR: z.string().default("data/uploads"),
  MASTER_API_KEY: requiredSecret("MASTER_API_KEY"),
  CONFIG_PATH: z.string().default("config/providers.yml"),
  OPENAI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  OPENROUTER_API_KEY: optionalString,
  ZAI_API_KEY: optionalString,
  CHATGPT_AUTHORIZATION: optionalString,
  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_PASSWORD_HASH: z
    .string({ required_error: "ADMIN_PASSWORD_HASH is required" })
    .regex(/^pbkdf2_sha256\$\d+\$[a-f0-9]+\$[a-f0-9]+$/i, "ADMIN_PASSWORD_HASH has an invalid format"),
  ADMIN_SESSION_SECRET: requiredSecret("ADMIN_SESSION_SECRET"),
  ADMIN_COOKIE_DOMAIN: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().regex(/^\.?[A-Za-z0-9.-]+$/, "ADMIN_COOKIE_DOMAIN has an invalid format").optional()
  ),
  CORS_ORIGINS: z.string().min(1).default("http://localhost:3000"),
  ENABLE_PROMPT_LOGGING: z
    .preprocess((value) => {
      if (typeof value === "string") {
        return value.toLowerCase() === "true";
      }
      return value;
    }, z.boolean())
    .default(false),
  WEB_SEARCH_BACKEND: z.enum(["searxng"]).default("searxng"),
  SEARXNG_URL: z.string().url().default("http://localhost:8080"),
  WEB_SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  WEB_SEARCH_MAX_RESULTS: z.coerce.number().int().positive().max(10).default(5),
  CHAT_AGENT_MAX_STEPS: z.coerce.number().int().positive().max(20).default(15),
  CHAT_CONTEXT_MAX_MESSAGES: z.coerce.number().int().positive().max(200).default(40)
});

const parsed = schema.parse(process.env);

export const env = {
  ...parsed,
  root,
  databasePath: parsed.DATABASE_URL.replace(/^file:/, ""),
  configPath: path.resolve(root, parsed.CONFIG_PATH),
  uploadPath: path.resolve(root, parsed.UPLOAD_DIR),
  corsOrigins: parsed.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
};
