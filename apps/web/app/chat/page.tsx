import ChatPageClient from "./page-client";
import { getConfigChatModels } from "@/lib/config-models";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return <ChatPageClient initialModels={getConfigChatModels()} />;
}
