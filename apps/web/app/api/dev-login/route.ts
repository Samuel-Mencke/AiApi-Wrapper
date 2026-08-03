import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  // Return HTML with inline redirect so the cookie is set before navigation
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/dashboard"></head><body>Redirecting...</body></html>`;
  const response = new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html" } });
  const isHttps = request.nextUrl.protocol === "https:";
  response.cookies.set("model_console_admin", token, {
    path: "/",
    maxAge: 86400,
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
  });
  return response;
}
