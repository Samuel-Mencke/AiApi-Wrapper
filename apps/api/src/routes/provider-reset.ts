/** Parse the exact UTC reset timestamp included in Z.AI usage-limit errors. */
export function parseProviderResetAt(message: string | null | undefined): string | null {
  if (!message) return null;
  const match = message.match(/(?:limit\s+will\s+reset|reset(?:s|ting)?(?:\s+at)?)\s+(?:at\s+)?(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*(Z|UTC))?/i);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T${match[2]}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function isProviderResetActive(resetAt: string | null, now = new Date()): boolean {
  return resetAt !== null && new Date(resetAt).getTime() > now.getTime();
}
