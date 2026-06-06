import { getConfigChatModels } from "@/lib/config-models";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ data: getConfigChatModels() });
}
