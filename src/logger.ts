import { spawn } from "bun";
import { createReadStream, createWriteStream, WriteStream, existsSync } from "fs";
import { unlink } from "fs/promises";
import { createHash } from "crypto";
import { createGzip } from "zlib";
import { pipeline } from "stream/promises";

type LogType = "input" | "output";

interface LogEntry {
  t: number;        // monotonic time (seconds)
  type: LogType;
  data: string;     // base64 encoded
  hash: string;     // hash chain
}

export class PTYLogger {
  private stream: WriteStream;
  private lastHash: string = "";
  private queue: string[] = [];
  private writing = false;

  constructor(private filepath: string) {
    this.stream = createWriteStream(filepath, { flags: "a" });
  }

  private now(): number {
    return Number(process.hrtime.bigint()) / 1e9;
  }

  private hash(prev: string, entry: Omit<LogEntry, "hash">): string {
    const h = createHash("sha256");
    h.update(prev);
    h.update(JSON.stringify(entry));
    return h.digest("hex");
  }

  private enqueue(line: string) {
    this.queue.push(line);
    this.flush();
  }

  private async flush() {
    if (this.writing) return;
    this.writing = true;

    while (this.queue.length > 0) {
      const line = this.queue.shift()!;
      if (!this.stream.write(line)) {
        await new Promise<void>((resolve) =>
          this.stream.once("drain", resolve)
        );
      }
    }

    this.writing = false;
  }

  private log(type: LogType, data: string | Uint8Array) {
    const buf =
      typeof data === "string"
        ? Buffer.from(data)
        : Buffer.from(data);

    const entryBase = {
      t: this.now(),
      type,
      data: buf.toString("base64"),
    };

    const hash = this.hash(this.lastHash, entryBase);
    this.lastHash = hash;

    const entry: LogEntry = {
      ...entryBase,
      hash,
    };

    this.enqueue(JSON.stringify(entry) + "\n");
  }

  input(data: string | Uint8Array) {
    this.log("input", data);
  }

  output(data: string | Uint8Array) {
    this.log("output", data);
  }

  async close():Promise<void> {
    await this.closeStream();
    await this.compress();
    await unlink(this.filepath);
  }

  private async closeStream(): Promise<void> {
    return new Promise((resolve)=>{
      this.stream.end(()=> resolve());
    })
  }

  private async hasXZ(): Promise<boolean> {
    try {
      const proc = spawn(["which", "xz"]);
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  private async compress(): Promise<void> {
    if (!existsSync(this.filepath)) return;

    if (await this.hasXZ()) {
      await this.compressXZ();
    } else {
      await this.compressGzip();
    }
  }

  private async compressXZ(): Promise<void> {
    const output = `${this.filepath}.xz`;

    const proc = spawn({
      cmd: ["xz", "-z", "-T0", "-c", this.filepath],
      stdout: "pipe",
    });

    const writeStream = createWriteStream(output);

    await pipeline(proc.stdout!, writeStream);
    await proc.exited;

    if (proc.exitCode !== 0) {
      throw new Error("xz compression failed");
    }
  }

  private async compressGzip(): Promise<void> {
    const input = createReadStream(this.filepath);
    const output = createWriteStream(`${this.filepath}.gz`);

    await pipeline(input, createGzip(), output);
  }
}

export function createLogFilename() {
  const iso = new Date().toISOString(); 
  // 例: 2026-03-28T05:12:34.567Z

  const safe = iso.replace(/[:.]/g, "-");
  // → 2026-03-28T05-12-34-567Z

  return `session-${safe}.jsonl`;
}
