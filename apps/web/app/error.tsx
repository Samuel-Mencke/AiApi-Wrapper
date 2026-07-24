"use client";

import { useEffect } from "react";

export default function RouteError({
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
    <main className="grid min-h-screen place-items-center bg-[#0a0a0a] px-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.035] p-6">
        <h1 className="text-lg font-semibold">The page could not be loaded</h1>
        <p className="mt-2 text-sm leading-6 text-white/60">
          The client state may be outdated after a deployment. Retry the page or reload it without cached files.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white"
          >
            Reload
          </button>
        </div>
      </div>
    </main>
  );
}
