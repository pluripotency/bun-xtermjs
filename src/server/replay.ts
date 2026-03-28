import { createReadStream } from "fs";
import readline from "readline";

type LogEntry = {
  t: number;
  type: "input" | "output";
  data: string; // base64
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function replay(logFile: string, term: any) {
  const stream = createReadStream(logFile);
  const rl = readline.createInterface({ input: stream });

  let prevT: number | null = null;

  for await (const line of rl) {
    const entry: LogEntry = JSON.parse(line);

    if (prevT !== null) {
      const delay = (entry.t - prevT) * 1000; // sec → ms
      if (delay > 0) {
        await sleep(delay);
      }
    }

    prevT = entry.t;

    // base64 → raw
    const buf = Buffer.from(entry.data, "base64");

    // 出力だけ再生（通常）
    if (entry.type === "output") {
      term.write(buf.toString());
    }
  }
}
