import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { userPreferences } from "../db/schema.js";
import { requireAdminAuth } from "../middleware/auth.js";

// Valid IDs for the new base:accent format
const VALID_BASE_IDS = ["obsidian", "midnight", "warm", "slate", "forest"];
const VALID_ACCENT_IDS = ["blue", "green", "violet", "orange", "cyan", "rose", "amber", "indigo", "teal", "pink"];

// Legacy theme IDs (still accepted for backwards compat)
const LEGACY_THEME_IDS = [
  "claude-warm", "midnight", "pure-dark", "forest", "sunset",
  "ocean", "lavender", "rose", "slate", "nordic"
];

const PREF_ROW_ID = "default";

const putBodySchema = z.object({
  themeId: z.string().min(1)
});

function isValidThemeId(raw: string): boolean {
  // New format: "base:accent"
  if (raw.includes(":")) {
    const [base, accent] = raw.split(":");
    return VALID_BASE_IDS.includes(base) && VALID_ACCENT_IDS.includes(accent);
  }
  // Legacy format
  return LEGACY_THEME_IDS.includes(raw);
}

export async function adminPreferencesRoutes(app: FastifyInstance) {
  app.get("/admin/preferences", { preHandler: requireAdminAuth }, async () => {
    const row = db.select().from(userPreferences).where(eq(userPreferences.id, PREF_ROW_ID)).get();
    return {
      data: {
        themeId: row?.themeId ?? "obsidian:green"
      }
    };
  });

  app.put("/admin/preferences", { preHandler: requireAdminAuth }, async (request) => {
    const parsed = putBodySchema.parse(request.body);
    if (!isValidThemeId(parsed.themeId)) {
      return { error: { message: `Invalid themeId: ${parsed.themeId}`, type: "invalid_request_error" } };
    }
    const now = new Date().toISOString();
    const existing = db.select().from(userPreferences).where(eq(userPreferences.id, PREF_ROW_ID)).get();
    if (existing) {
      db.update(userPreferences)
        .set({ themeId: parsed.themeId, updatedAt: now })
        .where(eq(userPreferences.id, PREF_ROW_ID))
        .run();
    } else {
      db.insert(userPreferences)
        .values({ id: PREF_ROW_ID, themeId: parsed.themeId, updatedAt: now })
        .run();
    }
    return { data: { themeId: parsed.themeId } };
  });
}
