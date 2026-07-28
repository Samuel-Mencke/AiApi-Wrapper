import type { InternalChatRequest } from "@model-console/core";

const requestSignals = new WeakMap<InternalChatRequest, Set<AbortSignal>>();

export function addRequestAbortSignal(
  request: InternalChatRequest,
  signal: AbortSignal,
): () => void {
  let signals = requestSignals.get(request);
  if (!signals) {
    signals = new Set<AbortSignal>();
    requestSignals.set(request, signals);
  }
  signals.add(signal);
  return () => {
    const current = requestSignals.get(request);
    current?.delete(signal);
    if (current?.size === 0) requestSignals.delete(request);
  };
}

export function getRequestAbortSignal(
  request: InternalChatRequest,
): AbortSignal | undefined {
  const signals = Array.from(requestSignals.get(request) ?? []);
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

export function providerRequestSignal(
  request: InternalChatRequest,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = getRequestAbortSignal(request);
  return requestSignal
    ? AbortSignal.any([requestSignal, timeoutSignal])
    : timeoutSignal;
}

export function requestWasAborted(request: InternalChatRequest): boolean {
  return getRequestAbortSignal(request)?.aborted === true;
}

export async function sleepWithRequestAbort(
  request: InternalChatRequest,
  delayMs: number,
): Promise<void> {
  const signal = getRequestAbortSignal(request);
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Request aborted", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new DOMException("Request aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function providerTimeoutMs(): number {
  const configured = Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS ?? 900_000);
  return Number.isFinite(configured) && configured >= 1_000
    ? Math.floor(configured)
    : 900_000;
}
