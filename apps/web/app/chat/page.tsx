import { redirect } from "next/navigation";

export default function ChatRedirectPage() {
  const chatUrl = process.env.NEXT_PUBLIC_CHAT_URL?.trim();
  redirect(chatUrl || "/dashboard");
}
