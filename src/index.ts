import { serve } from "bun";
import index from "./index.html";
import { spawn } from "bun-pty";
import type { IPty } from "bun-pty";
import { config } from "./config";

let isTerminalInUse = false;

const server = serve({
  port: config.port,
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,
  },

  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/api/terminal/ws") {
      const token = url.searchParams.get("token");
      if (token !== config.TERMINAL_PASSWORD) {
        return new Response("Unauthorized", { status: 401 });
      }
      
      const upgraded = server.upgrade(req, {
        data: {
          token,
        }
      });
      if (upgraded) return;
      return new Response("Upgrade failed", { status: 500 });
    }
    // Fallback to routes
    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws) {
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

      const dataHandler = ptyProcess.onData((data) => {
        ws.send(data);
      });

      // Store the pty process and handler on the websocket context
      (ws.data as any).ptyProcess = ptyProcess;
      (ws.data as any).dataHandler = dataHandler;
    },
    message(ws, message) {
      const ptyProcess = (ws.data as any).ptyProcess as IPty;
      if (!ptyProcess) return;

      if (typeof message === "string") {
        try {
          const json = JSON.parse(message);
          if (json.type === "resize") {
            ptyProcess.resize(json.cols, json.rows);
            return;
          }
        } catch (e) {
          // If it's not JSON, it's just raw terminal input
          ptyProcess.write(message);
        }
      } else {
        // Handle binary data
        ptyProcess.write(message.toString());
      }
    },
    close(ws) {
      if ((ws.data as any).hasLock) {
        isTerminalInUse = false;
      }
      
      const ptyProcess = (ws.data as any).ptyProcess as IPty;
      const dataHandler = (ws.data as any).dataHandler;
      
      if (dataHandler && typeof dataHandler.dispose === 'function') {
        dataHandler.dispose();
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
