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

const MAX_DELAY_MS = 100;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Replay a log file over a WebSocket connection.
 * Decompresses .xz / .gz files automatically.
 * Streams only "output" entries with original timing (scaled by speed).
 */
export async function replayToWebSocket(
  ws: { send(data: string | Uint8Array): void; readyState: number; close(code?: number, reason?: string): void },
  logFile: string,
  speed: number = 1,
) {
  if (!existsSync(logFile)) {
    ws.send(JSON.stringify({ type: "error", message: "Log file not found" }));
    ws.close(4004, "Log file not found");
    return;
  }

  let inputStream: NodeJS.ReadableStream;

  if (logFile.endsWith(".xz")) {
    // Decompress with xz
    const proc = spawn({
      cmd: ["xz", "-d", "-c", logFile],
      stdout: "pipe",
    });
    inputStream = Readable.fromWeb(proc.stdout as any);
  } else if (logFile.endsWith(".gz")) {
    // Decompress with zlib
    const raw = createReadStream(logFile);
    inputStream = raw.pipe(createGunzip());
  } else {
    // Plain .jsonl
    inputStream = createReadStream(logFile);
  }

  const rl = readline.createInterface({ input: inputStream });

  let prevT: number | null = null;

  for await (const line of rl) {
    // Check if WS is still open (readyState 1 = OPEN)
    if (ws.readyState !== 1) {
      rl.close();
      return;
    }

    let entry: LogEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // skip malformed lines
    }

    // Apply timing delay
    if (prevT !== null) {
      const rawDelay = (entry.t - prevT) * 1000; // sec → ms
      if (rawDelay > 0) {
        const scaledDelay = rawDelay / speed;
        const delay = Math.min(scaledDelay, MAX_DELAY_MS);
        if (delay > 1) {
          await sleep(delay);
        }
      }
    }

    prevT = entry.t;

    // Only replay output entries
    if (entry.type === "output") {
      const buf = Buffer.from(entry.data, "base64");
      ws.send(buf.toString());
    }
  }

  // Signal completion
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "done" }));
    ws.close(1000, "Replay complete");
  }
}
