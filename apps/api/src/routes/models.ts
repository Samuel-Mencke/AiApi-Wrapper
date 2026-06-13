import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GatewayError } from "@ai-gateway/core/errors";
import { requireApiAuth } from "../middleware/auth.js";
import { listModelAliases } from "../router/resolve-model.js";
import { CODEX_BASE_INSTRUCTIONS } from "../responses/codex-base-instructions.js";

type ModelAlias = ReturnType<typeof listModelAliases>[number];

function createdTimestamp(createdAt?: string): number {
  if (!createdAt) {
    return 0;
  }

  const value = Math.floor(new Date(createdAt).getTime() / 1000);
  return Number.isFinite(value) ? value : 0;
}

function toOpenAiModel(
  model: ModelAlias
): Record<string, unknown> {
  return {
    id: model.alias,
    object: "model",
    created: createdTimestamp(model.createdAt),
    owned_by: model.provider
  };
}

function contextWindow(alias: string): number {
  if (alias === "glm5-turbo" || alias === "glm5.1") {
    return 200_000;
  }

  return 128_000;
}

function description(alias: string): string {
  if (alias === "glm5-turbo") {
    return "GLM-5-Turbo configured for agentic Codex workflows.";
  }

  if (alias === "glm5.1") {
    return "GLM-5.1 configured for long-horizon Codex workflows.";
  }

  return `${alias} configured for Codex CLI workflows.`;
}

function toCodexModel(
  model: ModelAlias,
  priority: number
): Record<string, unknown> {
  const window = contextWindow(model.alias);

  return {
    slug: model.alias,
    display_name: model.alias,
    description: description(model.alias),

    default_reasoning_level: "high",
    supported_reasoning_levels: [
      {
        effort: "low",
        description: "Faster responses with lighter reasoning."
      },
      {
        effort: "medium",
        description: "Balanced reasoning for normal coding work."
      },
      {
        effort: "high",
        description: "Deeper reasoning for difficult coding work."
      }
    ],

    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    priority,

    additional_speed_tiers: [],
    service_tiers: [],
    default_service_tier: null,
    availability_nux: null,
    upgrade: null,

    base_instructions: CODEX_BASE_INSTRUCTIONS,
    model_messages: null,

    supports_reasoning_summaries: false,
    default_reasoning_summary: "auto",
    support_verbosity: false,
    default_verbosity: null,

    /*
     * Z.AI Chat Completions only supports function tools.
     * File editing remains available through the shell.
     */
    apply_patch_tool_type: null,

    web_search_tool_type: "text",

    truncation_policy: {
      mode: "tokens",
      limit: 10_000
    },

    supports_parallel_tool_calls: true,
    supports_image_detail_original: false,

    context_window: window,
    max_context_window: window,
    auto_compact_token_limit: Math.floor(window * 0.9),
    effective_context_window_percent: 90,
    comp_hash: null,

    experimental_supported_tools: [],
    input_modalities: ["text"],

    supports_search_tool: false,
    use_responses_lite: false,
    auto_review_model_override: null,

    /*
     * Direct exposes the normal Codex function tools.
     * V1 enables the established subagent tool set.
     */
    tool_mode: "direct",
    multi_agent_version: "v1"
  };
}

export async function modelRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get(
    "/v1/models",
    { preHandler: requireApiAuth },
    async (request, reply) => {
      const enabledModels = listModelAliases().filter(
        (model) => model.enabled
      );

      const query =
        request.query && typeof request.query === "object"
          ? request.query as Record<string, unknown>
          : {};

      /*
       * Codex appends client_version and expects its own
       * model-catalog response format.
       */
      if (typeof query.client_version === "string") {
        const zAiModels = enabledModels.filter(
          (model) => model.provider === "z-ai"
        );

        const codexModels =
          zAiModels.length > 0 ? zAiModels : enabledModels;

        reply.header("Cache-Control", "no-cache");

        return {
          models: codexModels.map(
            (model, index) => toCodexModel(model, index + 1)
          )
        };
      }

      /*
       * Preserve the standard OpenAI-compatible response
       * for all other clients.
       */
      return {
        object: "list",
        data: enabledModels.map(toOpenAiModel)
      };
    }
  );

  app.get(
    "/v1/models/:model",
    { preHandler: requireApiAuth },
    async (request) => {
      const params = z.object({
        model: z.string().min(1)
      }).parse(request.params);

      const model = listModelAliases().find(
        (item) =>
          item.enabled
          && item.alias === params.model
      );

      if (!model) {
        throw new GatewayError(
          `The model '${params.model}' does not exist.`,
          {
            code: "model_not_found",
            statusCode: 404,
            param: "model"
          }
        );
      }

      return toOpenAiModel(model);
    }
  );
}
