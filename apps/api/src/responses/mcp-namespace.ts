export interface ResponseToolIdentity {
  name: string;
  namespace?: string;
}

const MCP_TOOL_NAME_PREFIX = "mcp__";
const TOOL_NAME_DELIMITER = "__";

export function flattenNamespacedToolName(name: string, namespace?: string): string {
  const normalizedName = name.trim().replace(/^_+/, "");
  if (!namespace) return normalizedName;
  const normalizedNamespace = namespace.trim().replace(/_+$/, "");
  return `${normalizedNamespace}${TOOL_NAME_DELIMITER}${normalizedName}`;
}

export function splitNamespacedToolName(chatName: string): ResponseToolIdentity {
  const name = chatName.trim();
  if (!name.startsWith(MCP_TOOL_NAME_PREFIX)) return { name };
  const delimiterIndex = name.lastIndexOf(TOOL_NAME_DELIMITER);
  if (delimiterIndex <= 3) return { name };
  const namespace = name.slice(0, delimiterIndex);
  const nestedName = name.slice(delimiterIndex + TOOL_NAME_DELIMITER.length);
  return namespace && nestedName ? { name: nestedName, namespace } : { name };
}
