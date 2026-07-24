"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0a", color: "#ffffff", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 440, border: "1px solid rgba(255,255,255,.12)", borderRadius: 16, padding: 24, background: "rgba(255,255,255,.035)" }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>The application could not be loaded</h1>
            <p style={{ margin: "12px 0 0", color: "rgba(255,255,255,.62)", fontSize: 14, lineHeight: 1.6 }}>
              A cached application file may no longer match the deployed version.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
              <button type="button" onClick={reset} style={{ border: 0, borderRadius: 8, padding: "10px 14px", fontWeight: 600, cursor: "pointer" }}>
                Retry
              </button>
              <button type="button" onClick={() => window.location.reload()} style={{ border: "1px solid rgba(255,255,255,.18)", borderRadius: 8, padding: "10px 14px", background: "transparent", color: "white", cursor: "pointer" }}>
                Reload
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
