import type { InternalChatRequest } from "@model-console/core";
import { getRequestAbortSignal } from "./request-control.js";

interface ProviderPriorityState {
  interactiveActive: number;
  backgroundControllers: Set<AbortController>;
  drainWaiters: Set<() => void>;
}

export interface PriorityLease {
  signal?: AbortSignal;
  release(): void;
}

const states = new Map<string, ProviderPriorityState>();

function stateFor(provider: string): ProviderPriorityState {
  let state = states.get(provider);
  if (!state) {
    state = {
      interactiveActive: 0,
      backgroundControllers: new Set<AbortController>(),
      drainWaiters: new Set<() => void>(),
    };
    states.set(provider, state);
  }
  return state;
}

function backgroundKeyIds(): Set<string> {
  return new Set(
    (process.env.BACKGROUND_API_KEY_IDS ?? "money-agent")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function isBackgroundRequest(apiKeyId: string | null): boolean {
  return apiKeyId !== null && backgroundKeyIds().has(apiKeyId);
}

async function waitForInteractiveDrain(
  state: ProviderPriorityState,
  request: InternalChatRequest,
): Promise<void> {
  while (state.interactiveActive > 0) {
    const signal = getRequestAbortSignal(request);
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Request aborted", "AbortError");
    }
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(signal?.reason ?? new DOMException("Request aborted", "AbortError"));
      };
      const cleanup = () => {
        state.drainWaiters.delete(done);
        signal?.removeEventListener("abort", onAbort);
      };
      state.drainWaiters.add(done);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export async function acquireProviderPriority(
  provider: string,
  request: InternalChatRequest,
  background: boolean,
): Promise<PriorityLease> {
  const state = stateFor(provider);
  if (!background) {
    state.interactiveActive += 1;
    for (const controller of state.backgroundControllers) {
      controller.abort(
        new DOMException("Preempted by an interactive request", "AbortError"),
      );
    }
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        state.interactiveActive = Math.max(0, state.interactiveActive - 1);
        if (state.interactiveActive === 0) {
          for (const wake of Array.from(state.drainWaiters)) wake();
        }
      },
    };
  }

  await waitForInteractiveDrain(state, request);
  const controller = new AbortController();
  state.backgroundControllers.add(controller);
  let released = false;
  return {
    signal: controller.signal,
    release() {
      if (released) return;
      released = true;
      state.backgroundControllers.delete(controller);
    },
  };
}
