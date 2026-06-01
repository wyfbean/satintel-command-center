/**
 * Process-internal ingestion scheduler.
 *
 * Next.js re-evaluates modules on HMR; a globalThis guard prevents duplicate
 * timers in development.  Call ensureScheduler() once from the feed API route
 * so the scheduler starts lazily on the first real HTTP request (never at
 * build time or during SSR prerendering).
 *
 * Intervals:
 *   - RSS + crawl + AI articles: every 30 minutes
 *
 * The first cycle runs immediately in the background so fresh data is available
 * quickly after a cold start.
 */

import { runIngestionCycle } from "@/lib/intel/ingestion-worker";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

type SchedulerState = {
  initialized: boolean;
  lastRunAt: number | null;
  lastResult: { itemsIn: number; itemsNew: number; durationMs: number; error?: string } | null;
  running: boolean;
  totalRuns: number;
};

const G = globalThis as typeof globalThis & { __satintelScheduler?: SchedulerState };

function getState(): SchedulerState {
  if (!G.__satintelScheduler) {
    G.__satintelScheduler = {
      initialized: false,
      lastRunAt: null,
      lastResult: null,
      running: false,
      totalRuns: 0,
    };
  }
  return G.__satintelScheduler;
}

async function tick() {
  const state = getState();
  if (state.running) return; // skip if previous cycle still in progress
  state.running = true;
  state.totalRuns++;
  try {
    const result = await runIngestionCycle();
    state.lastRunAt = Date.now();
    state.lastResult = result;
    if (result.error) {
      console.error("[scheduler] ingestion error:", result.error);
    } else {
      console.log(
        `[scheduler] cycle done — ${result.itemsIn} in, ${result.itemsNew} new, ${result.durationMs}ms`,
      );
    }
  } catch (err) {
    console.error("[scheduler] unexpected error:", err);
  } finally {
    state.running = false;
  }
}

/** Idempotent: safe to call on every API request. */
export function ensureScheduler(): void {
  const state = getState();
  if (state.initialized) return;
  state.initialized = true;

  // First run immediately (non-blocking)
  void tick();

  // Then on the regular interval
  setInterval(() => void tick(), INTERVAL_MS);

  console.log("[scheduler] started, interval =", INTERVAL_MS / 1000, "s");
}

/** Returns a snapshot of the scheduler state (for the status endpoint). */
export function getSchedulerStatus() {
  const state = getState();
  return {
    initialized: state.initialized,
    running: state.running,
    totalRuns: state.totalRuns,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    nextRunInMs: state.lastRunAt ? Math.max(0, state.lastRunAt + INTERVAL_MS - Date.now()) : null,
  };
}
