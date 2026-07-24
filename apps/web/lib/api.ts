// All API calls go through the Next.js dev server / standalone server,
// which proxies them to the backend via next.config.ts rewrites.
// This avoids CORS issues and keeps the backend URL server-side only.
// The docs page needs the public API URL for display. It is compiled from
// NEXT_PUBLIC_PUBLIC_API_URL while application requests stay on /api.

export const API_BASE_URL = "/api"; // proxied through Next.js → backend
export const PUBLIC_API_URL =
  process.env.NEXT_PUBLIC_PUBLIC_API_URL ?? "http://localhost:18789";

export interface ApiEnvelope<T> {
  data: T;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const hasBody = init?.body != null;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/login")
    ) {
      window.location.href = "/login";
    }
    throw new Error(
      body?.error?.message ?? `Request failed: ${response.status}`,
    );
  }

  return response.json() as Promise<T>;
}
