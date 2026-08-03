import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const dynamic = "force-dynamic";
export const revalidate = 0;

const chunkRecoveryScript = `
(() => {
  const recoveryKey = "model-console-chunk-recovery";
  const patterns = [
    "ChunkLoadError",
    "Loading chunk",
    "Failed to fetch dynamically imported module",
    "Importing a module script failed",
    "Failed to load module script"
  ];

  const textFrom = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.name + ": " + value.message;
    return String(value);
  };

  const shouldRecover = (value) => {
    const text = textFrom(value);
    return patterns.some((pattern) => text.includes(pattern));
  };

  const recover = () => {
    try {
      const now = Date.now();
      const lastAttempt = Number(sessionStorage.getItem(recoveryKey) || "0");
      if (now - lastAttempt < 30000) return;
      sessionStorage.setItem(recoveryKey, String(now));
      const url = new URL(window.location.href);
      url.searchParams.set("__mc_reload", String(now));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  };

  window.addEventListener("error", (event) => {
    if (shouldRecover(event.error) || shouldRecover(event.message)) recover();
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    if (shouldRecover(event.reason)) recover();
  });

  if (new URL(window.location.href).searchParams.has("__mc_reload")) {
    window.addEventListener("load", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("__mc_reload");
      window.history.replaceState({}, "", url.toString());
    }, { once: true });
  }
})();`;

export const metadata: Metadata = {
  title: "Model Console",
  description: "Self-hosted model API — unified chat, routing and analytics"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: chunkRecoveryScript }} />
      </head>
      <body className="overscroll-none"><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
