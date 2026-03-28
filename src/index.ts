import { serve } from "bun";
import index from "./index.html";
import { spawn } from "bun-pty";
import type { IPty } from "bun-pty";
import { config } from "./config";
import { PTYLogger, createLogFilename } from "./logger";
import { replayToWebSocket, ReplayController } from "./replay-ws";
import { readdir } from "fs/promises";
import path from "path";

let isTerminalInUse = false;

const server = serve({
  port: config.port,
  routes: {
    "/*": index,
    "/api/logs": {
      async GET(req) {
        const url = new URL(req.url);
        const token = url.searchParams.get("token");
        if (token !== config.TERMINAL_PASSWORD) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const files = await readdir(config.session_log_dir);
          const logFiles = files
            .filter((f) => f.endsWith(".jsonl") || f.endsWith(".jsonl.gz") || f.endsWith(".jsonl.xz"))
            .sort()
            .reverse(); // newest first
          return Response.json(logFiles);
        } catch {
          return Response.json([]);
        }
      },
    },
  },

  async fetch(req, server) {
    const url = new URL(req.url);

    // --- WebSocket: live terminal ---
    if (url.pathname === "/api/terminal/ws") {
      const token = url.searchParams.get("token");
      if (token !== config.TERMINAL_PASSWORD) {
        return new Response("Unauthorized", { status: 401 });
      }
      
      const upgraded = server.upgrade(req, {
        data: {
          token,
          wsType: "terminal",
        }
      });
      if (upgraded) return;
      return new Response("Upgrade failed", { status: 500 });
    }

    // --- WebSocket: log replay ---
    if (url.pathname === "/api/logs/replay") {
      const token = url.searchParams.get("token");
      if (token !== config.TERMINAL_PASSWORD) {
        return new Response("Unauthorized", { status: 401 });
      }

      const file = url.searchParams.get("file");
      if (!file) {
        return new Response("Missing file parameter", { status: 400 });
      }

      // Prevent path traversal
      const basename = path.basename(file);
      if (basename !== file) {
        return new Response("Invalid file parameter", { status: 400 });
      }

      const speed = Math.min(Math.max(parseFloat(url.searchParams.get("speed") || "1"), 0.1), 100);

      const upgraded = server.upgrade(req, {
        data: {
          token,
          wsType: "replay",
          logFile: path.join(config.session_log_dir, basename),
          speed,
        }
      });
      if (upgraded) return;
      return new Response("Upgrade failed", { status: 500 });
    }

    // Fallback
    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const wsType = (ws.data as any).wsType;

      if (wsType === "replay") {
        // Start log replay
        const { logFile, speed } = ws.data as any;
        const controller = new ReplayController();
        (ws.data as any).controller = controller;
        replayToWebSocket(ws as any, logFile, speed, controller).catch((err) => {
          console.error("Replay error:", err);
          try { ws.close(4500, "Replay error"); } catch {}
        });
        return;
      }

      // --- Terminal WebSocket (original logic) ---
      if (isTerminalInUse) {
        ws.close(4001, "Terminal is already in use by another user");
        return;
      }
      isTerminalInUse = true;
      (ws.data as any).hasLock = true;

      const ptyProcess = spawn(config.shell, [], {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || process.cwd(),
        env: process.env as any,
      });

      const logger = new PTYLogger(`${config.session_log_dir}/${createLogFilename()}`)
      const dataHandler = ptyProcess.onData((data) => {
        logger.output(data);
        ws.send(data);
      });

      // Store the pty process and handler on the websocket context
      (ws.data as any).ptyProcess = ptyProcess;
      (ws.data as any).dataHandler = dataHandler;
      (ws.data as any).logger = logger;
    },
    message(ws, message) {
      const wsType = (ws.data as any).wsType;
      if (wsType === "replay") {
        // Handle pause/resume control messages for replay
        try {
          const json = JSON.parse(message.toString());
          const controller = (ws.data as any).controller as ReplayController | undefined;
          if (json.type === "pause") controller?.pause();
          else if (json.type === "resume") controller?.resume();
        } catch {}
        return;
      }

      const ptyProcess = (ws.data as any).ptyProcess as IPty;
      const logger = (ws.data as any).logger;
      if (!ptyProcess) return;

      if (typeof message === "string") {
        try {
          const json = JSON.parse(message);
          if (json.type === "resize") {
            ptyProcess.resize(json.cols, json.rows);
            return;
          }
          logger.input(message);
          ptyProcess.write(message);
        } catch (e) {
          // If it's not JSON, it's just raw terminal input
          logger.input(message);
          ptyProcess.write(message);
        }
      } else {
        // Handle binary data
        logger.input(message.toString());
        ptyProcess.write(message.toString());
      }
    },
    close(ws) {
      const wsType = (ws.data as any).wsType;
      if (wsType === "replay") return; // nothing to clean up for replay

      if ((ws.data as any).hasLock) {
        isTerminalInUse = false;
      }
      
      const ptyProcess = (ws.data as any).ptyProcess as IPty;
      const dataHandler = (ws.data as any).dataHandler;
      
      if (dataHandler && typeof dataHandler.dispose === 'function') {
        dataHandler.dispose();
      }

      const logger = (ws.data as any).logger;
      if (logger && typeof logger.close === 'function') {
        logger.close();
      }
      
      if (ptyProcess) {
        ptyProcess.kill();
      }
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
