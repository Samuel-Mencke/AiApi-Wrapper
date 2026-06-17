import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { userPreferences } from "../db/schema.js";
import { requireAdminAuth } from "../middleware/auth.js";

const VALID_THEME_IDS = [
  "claude-warm", "midnight", "pure-dark", "forest", "sunset",
  "ocean", "lavender", "rose", "slate", "nordic"
];

const PREF_ROW_ID = "default";

const putBodySchema = z.object({
  themeId: z.string().min(1)
});

export async function adminPreferencesRoutes(app: FastifyInstance) {
  app.get("/admin/preferences", { preHandler: requireAdminAuth }, async () => {
    const row = db.select().from(userPreferences).where(eq(userPreferences.id, PREF_ROW_ID)).get();
    return {
      data: {
        themeId: row?.themeId ?? "claude-warm"
      }
    };
  });

  app.put("/admin/preferences", { preHandler: requireAdminAuth }, async (request) => {
    const parsed = putBodySchema.parse(request.body);
    if (!VALID_THEME_IDS.includes(parsed.themeId)) {
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
