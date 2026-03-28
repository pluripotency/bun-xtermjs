import { spawn } from "bun";
import { createReadStream, existsSync } from "fs";
import { createGunzip } from "zlib";
import readline from "readline";
import { Readable } from "stream";

type LogEntry = {
  t: number;
  type: "input" | "output";
  data: string; // base64
};

export interface TimelineEvent {
  rel: number;            // 0–1 relative position in session
  type: "input" | "output";
}

export interface TimelineData {
  duration: number;       // total session duration in seconds
  firstT: number;         // absolute timestamp of first entry
  events: TimelineEvent[]; // sampled events for rendering markers
}

const MAX_DELAY_MS = 2000;
const PROGRESS_INTERVAL_MS = 200;
const MAX_TIMELINE_EVENTS = 1200; // max marker dots to return

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Shared decompression helper */
function getInputStream(logFile: string): NodeJS.ReadableStream {
  if (logFile.endsWith(".xz")) {
    const proc = spawn({ cmd: ["xz", "-d", "-c", logFile], stdout: "pipe" });
    return Readable.fromWeb(proc.stdout as any);
  } else if (logFile.endsWith(".gz")) {
    return createReadStream(logFile).pipe(createGunzip());
  } else {
    return createReadStream(logFile);
  }
}

/**
 * A pausable controller for the replay loop.
 * Call pause() to block, resume() to unblock.
 */
export class ReplayController {
  private _paused = false;
  private _resolve: (() => void) | null = null;
  private _promise: Promise<void> = Promise.resolve();

  pause() {
    if (this._paused) return;
    this._paused = true;
    this._promise = new Promise((r) => {
      this._resolve = r;
    });
  }

  resume() {
    if (!this._paused) return;
    this._paused = false;
    this._resolve?.();
    this._resolve = null;
  }

  /** Awaitable gate — resolves immediately when not paused */
  get gate(): Promise<void> {
    return this._promise;
  }

  get paused() {
    return this._paused;
  }
}

/**
 * Read timeline metadata from a log file (without streaming it to a client).
 * Returns duration, firstT, and a sampled set of event positions for the UI.
 */
export async function readTimeline(logFile: string): Promise<TimelineData> {
  if (!existsSync(logFile)) {
    return { duration: 0, firstT: 0, events: [] };
  }

  const rl = readline.createInterface({ input: getInputStream(logFile) });
  const raw: { t: number; type: "input" | "output" }[] = [];

  for await (const line of rl) {
    try {
      const e = JSON.parse(line) as LogEntry;
      raw.push({ t: e.t, type: e.type });
    } catch {
      continue;
    }
  }

  if (raw.length === 0) return { duration: 0, firstT: 0, events: [] };

  const firstT = raw[0]!.t;
  const lastT = raw[raw.length - 1]!.t;
  const duration = Math.max(0, lastT - firstT);

  // Sample events (avoid sending thousands of markers)
  let events: TimelineEvent[];
  if (raw.length <= MAX_TIMELINE_EVENTS) {
    events = raw.map((e) => ({
      rel: duration > 0 ? (e.t - firstT) / duration : 0,
      type: e.type,
    }));
  } else {
    const step = raw.length / MAX_TIMELINE_EVENTS;
    events = Array.from({ length: MAX_TIMELINE_EVENTS }, (_, i) => {
      const e = raw[Math.floor(i * step)]!;
      return {
        rel: duration > 0 ? (e.t - firstT) / duration : 0,
        type: e.type,
      };
    });
  }

  return { duration, firstT, events };
}

/**
 * Replay a log file over a WebSocket connection.
 * - Decompresses .xz / .gz files automatically.
 * - Fast-forwards all entries before startOffset (seconds from firstT) to restore terminal state.
 * - Sends throttled {type:"progress", elapsed, rel} events during normal playback.
 * - Supports pause/resume via ReplayController.
 */
export async function replayToWebSocket(
  ws: {
    send(data: string | Uint8Array): void;
    readyState: number;
    close(code?: number, reason?: string): void;
  },
  logFile: string,
  speed: number = 1,
  controller: ReplayController = new ReplayController(),
  startOffset: number = 0,   // seconds from firstT — fast-forward up to this point
  duration: number = 0,      // total duration for progress rel calculation (0 = skip rel)
) {
  if (!existsSync(logFile)) {
    ws.send(JSON.stringify({ type: "error", message: "Log file not found" }));
    ws.close(4004, "Log file not found");
    return;
  }

  const rl = readline.createInterface({ input: getInputStream(logFile) });

  let firstT: number | null = null;
  let prevT: number | null = null;
  let lastProgressMs = 0;
  let fastFwdCount = 0;

  for await (const line of rl) {
    if (ws.readyState !== 1) { rl.close(); return; }

    let entry: LogEntry;
    try { entry = JSON.parse(line); }
    catch { continue; }

    if (firstT === null) firstT = entry.t;

    const elapsed = entry.t - firstT;
    const isFastForward = elapsed < startOffset;

    if (isFastForward) {
      // Write output to restore terminal state, but no delays or pause gates
      if (entry.type === "output") {
        ws.send(Buffer.from(entry.data, "base64").toString());
      }
      // Yield event loop every 1000 entries to avoid blocking
      fastFwdCount++;
      if (fastFwdCount % 1000 === 0) {
        await new Promise((r) => setImmediate(r));
        if (ws.readyState !== 1) { rl.close(); return; }
      }
      prevT = entry.t;
      continue;
    }

    // --- Normal playback ---

    // Wait if paused
    await controller.gate;
    if (ws.readyState !== 1) { rl.close(); return; }

    // Timing delay
    if (prevT !== null) {
      const rawDelay = (entry.t - prevT) * 1000;
      if (rawDelay > 0) {
        const delay = Math.min(rawDelay / speed, MAX_DELAY_MS);
        if (delay > 1) {
          await sleep(delay);
          if (ws.readyState !== 1) { rl.close(); return; }
          // Re-check pause after delay
          await controller.gate;
          if (ws.readyState !== 1) { rl.close(); return; }
        }
      }
    }

    prevT = entry.t;

    if (entry.type === "output") {
      ws.send(Buffer.from(entry.data, "base64").toString());

      // Throttled progress event
      const now = Date.now();
      if (now - lastProgressMs > PROGRESS_INTERVAL_MS) {
        lastProgressMs = now;
        const rel = duration > 0 ? Math.min(1, elapsed / duration) : 0;
        ws.send(JSON.stringify({ type: "progress", elapsed, rel }));
      }
    }
  }

  // Signal completion
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "done" }));
    ws.close(1000, "Replay complete");
  }
}
