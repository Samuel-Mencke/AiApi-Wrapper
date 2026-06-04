import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "../../..");

dotenv.config({ path: path.resolve(root, ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

const schema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(18789),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:18789"),
  DASHBOARD_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().default("file:./gateway.db"),
  GATEWAY_MASTER_KEY: z.string().min(1).default("change-me"),
  CONFIG_PATH: z.string().default("config/providers.yml"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  ZAI_API_KEY: z.string().optional(),
  ENABLE_PROMPT_LOGGING: z
    .preprocess((value) => {
      if (typeof value === "string") {
        return value.toLowerCase() === "true";
      }
      return value;
    }, z.boolean())
    .default(false)
});

const parsed = schema.parse(process.env);

export const env = {
  ...parsed,
  root,
  databasePath: parsed.DATABASE_URL.replace(/^file:/, ""),
  configPath: path.resolve(root, parsed.CONFIG_PATH)
};
