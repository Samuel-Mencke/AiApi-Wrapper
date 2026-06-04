import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import {
  clearAdminSession,
  hasValidAdminSession,
  setAdminSession,
  verifyAdminPassword
} from "../middleware/auth.js";

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export async function adminAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/login", async (request, reply) => {
    const body = loginBody.parse(request.body);
    if (body.username !== env.ADMIN_USERNAME || !verifyAdminPassword(body.password)) {
      return reply.code(401).send({
        error: {
          code: "invalid_admin_login",
          message: "Invalid username or password"
        }
      });
    }

    setAdminSession(reply);
    return { ok: true, user: { username: env.ADMIN_USERNAME } };
  });

  app.post("/admin/logout", async (_request, reply) => {
    clearAdminSession(reply);
    return { ok: true };
  });

  app.get("/admin/session", async (request) => ({
    authenticated: hasValidAdminSession(request),
    user: hasValidAdminSession(request) ? { username: env.ADMIN_USERNAME } : null
  }));
}
