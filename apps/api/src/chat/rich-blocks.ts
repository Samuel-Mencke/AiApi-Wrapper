import { z } from "zod";

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const dataRow = z.record(scalar);

export const htmlBlockSchema = z.object({
  type: z.literal("html"),
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(100000),
  fullscreen: z.boolean().optional()
});

export const markdownBlockSchema = z.object({
  type: z.literal("markdown"),
  content: z.string()
});

export const codeBlockSchema = z.object({
  type: z.literal("code"),
  language: z.string().max(40).optional(),
  filename: z.string().max(120).optional(),
  content: z.string()
});

export const tableBlockSchema = z.object({
  type: z.literal("table"),
  title: z.string().max(160).optional(),
  columns: z.array(z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120)
  })).min(1).max(24),
  rows: z.array(z.record(scalar)).max(500),
  filterable: z.boolean().optional()
});

export const chartBlockSchema = z.object({
  type: z.literal("chart"),
  chartType: z.enum(["bar", "line", "pie", "scatter"]),
  title: z.string().max(160).optional(),
  xKey: z.string().min(1).max(80).optional(),
  series: z.array(z.object({
    dataKey: z.string().min(1).max(80),
    label: z.string().max(120).optional(),
    valueSuffix: z.string().max(16).optional()
  })).min(1).max(8),
  data: z.array(dataRow).max(500)
});

export const functionPlotBlockSchema = z.object({
  type: z.literal("function_plot"),
  title: z.string().max(160).optional(),
  expression: z.string().min(1).max(160),
  xMin: z.number().finite(),
  xMax: z.number().finite(),
  sampleCount: z.number().int().min(20).max(500),
  points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).optional()
});

export const mathBlockSchema = z.object({
  type: z.literal("math"),
  content: z.string().min(1).max(4000),
  display: z.boolean().optional()
});

export const toolCallBlockSchema = z.object({
  type: z.literal("tool_call"),
  toolName: z.string().min(1).max(80),
  input: z.record(z.unknown()),
  status: z.enum(["pending", "running", "completed", "failed"]).default("pending")
});

export const toolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  toolName: z.string().min(1).max(80),
  summary: z.string().max(4000),
  sources: z.array(z.object({ title: z.string().max(240), url: z.string().url() })).max(10).optional()
});

export const statusBlockSchema = z.object({
  type: z.literal("status"),
  status: z.enum(["thinking", "planning", "using_tool", "reading_results", "finalizing", "completed"]),
  content: z.string().max(1000).optional()
});

export const errorBlockSchema = z.object({
  type: z.literal("error"),
  message: z.string().max(2000),
  rawJson: z.unknown().optional()
});

export const richBlockSchema = z.discriminatedUnion("type", [
  markdownBlockSchema,
  codeBlockSchema,
  htmlBlockSchema,
  tableBlockSchema,
  chartBlockSchema,
  functionPlotBlockSchema,
  mathBlockSchema,
  toolCallBlockSchema,
  toolResultBlockSchema,
  statusBlockSchema,
  errorBlockSchema
]);

export const richBlocksSchema = z.object({
  blocks: z.array(richBlockSchema).max(80)
});

export type RichBlocks = z.infer<typeof richBlocksSchema>;

export function markdownOnly(content: string): RichBlocks {
  return { blocks: content ? [{ type: "markdown", content }] : [] };
}

export function validateRichBlocks(input: unknown, fallbackText = ""): RichBlocks {
  const normalized = normalizeRawRichBlocks(input);
  const parsed = richBlocksSchema.safeParse(normalized);
  if (parsed.success) return parsed.data;
  return markdownOnly(fallbackText);
}

function normalizeRawRichBlocks(input: unknown): unknown {
  if (!input || typeof input !== "object" || !("blocks" in input) || !Array.isArray((input as { blocks?: unknown[] }).blocks)) {
    return input;
  }

  return {
    blocks: (input as { blocks: unknown[] }).blocks.map((block) => {
      if (!block || typeof block !== "object") return block;
      const value = block as Record<string, unknown>;
      if (value.type === "function_plot") {
        return {
          ...value,
          xMin: typeof value.xMin === "number" ? value.xMin : value.x_min,
          xMax: typeof value.xMax === "number" ? value.xMax : value.x_max,
          sampleCount: typeof value.sampleCount === "number" ? value.sampleCount : typeof value.sample_count === "number" ? value.sample_count : 160
        };
      }
      if (value.type === "chart") {
        return {
          ...value,
          chartType: value.chartType ?? value.chart_type,
          xKey: value.xKey ?? value.x_key
        };
      }
      // html blocks are now rendered natively — no conversion needed
      return value;
    })
  };
}

export function parseRichBlocksFromText(content: string): { text: string; blocks: RichBlocks } {
  const fence = /```rich_blocks\s*([\s\S]*?)```/i.exec(content);
  if (!fence?.[1]) {
    return { text: content, blocks: markdownOnly(content) };
  }
  try {
    const json = JSON.parse(fence[1]);
    const text = content.replace(fence[0], "").trim();
    return { text: text || content, blocks: validateRichBlocks(json, text) };
  } catch {
    return { text: content, blocks: markdownOnly(content) };
  }
}
