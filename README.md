# Bun Web Terminal

A fast, lightweight web-based terminal and session log viewer built with **Bun**, **React**, **Tailwind CSS**, and **xterm.js**. It leverages `bun-pty` to spawn a secure, native terminal session directly accessible via your web browser, with full session recording and replay capabilities.

## Features

- ⚡️ **Blazing Fast**: Uses Bun's native HTTP server and WebSocket handling.
- 🎨 **Beautiful UI**: Full-screen, responsive terminal styled with xterm colors and a dark aesthetic.
- 🔒 **Password Authentication**: Simple token-based login to protect access.
- 🔐 **Single-User Lock**: Prevents multiple users from accessing the terminal simultaneously. If the terminal is in use, secondary users are safely declined until the first disconnects.
- 📏 **Automatic Resizing**: The terminal dynamically resizes the backend PTY columns and rows in real-time as you resize your browser window.
- 📝 **Session Logging**: All terminal sessions are automatically recorded as JSONL files with hash-chain integrity, then compressed (xz or gzip).
- 🔁 **Session Replay**: Browse and replay past terminal sessions directly in the browser with adjustable playback speed (1×–50×).
- 🛠️ **Cross-Platform Support**: Automatically detects your OS and uses `bash` for Linux/macOS or `powershell.exe` for Windows.

## Getting Started

### 1. Installation

Install all the necessary dependencies using Bun:
```bash
bun install
```

### 2. Configuration

Application settings are defined in `src/config.ts`:

| Setting | Default | Environment Variable |
|---------|---------|---------------------|
| Port | `3000` | `PORT` |
| Shell | `bash` / `powershell.exe` | — (auto-detected) |
| Password | `"secret"` | `TERMINAL_PASSWORD` |
| Log Directory | `./logs` | — |

### 3. Running

Start the development server with hot reloading:
```bash
bun dev
```

For production:
```bash
bun start
```

To build static assets:
```bash
bun run build
```

### 4. Usage

1. Open your browser and navigate to `http://localhost:3000`.
2. Enter the password (default: `secret`) and click **Connect**.
3. You land on the **Session Log Viewer** — browse and replay past sessions.
4. Click **🖥 Terminal** to open a live interactive terminal session.
5. Click **← Logs** from the terminal to return to the log viewer.
6. Click **Disconnect** from either view to log out.

## Architecture

```
src/
├── index.ts              # Bun server — HTTP routes, WebSocket handlers
├── index.html            # HTML entry point
├── frontend.tsx          # React DOM bootstrap
├── App.tsx               # View routing (auth → logs → terminal)
├── config.ts             # Server configuration
├── logger.ts             # PTYLogger — session recording with hash chain
├── replay.ts             # CLI replay utility
├── replay-ws.ts          # WebSocket replay — streams logs to browser
├── index.css             # Global styles
├── components/
│   ├── TerminalAuth.tsx   # Login form
│   ├── TerminalUI.tsx     # Live terminal (xterm.js + WebSocket)
│   └── ui/                # Shared UI primitives (button, card, input, etc.)
├── ui/
│   └── TerminalLogView.tsx # Session log browser + replay viewer
└── lib/
    └── utils.ts           # Utility functions
```

### API Endpoints

| Endpoint | Type | Description |
|----------|------|-------------|
| `GET /api/logs?token=...` | REST | List available session log files |
| `WS /api/terminal/ws?token=...` | WebSocket | Live terminal PTY connection |
| `WS /api/logs/replay?file=...&token=...&speed=...` | WebSocket | Stream session replay |

### Session Logs

Sessions are recorded to `./logs/` as JSONL files. Each line is a JSON object:

```json
{"t":1234.567,"type":"output","data":"<base64>","hash":"<sha256>"}
```

- `t` — monotonic timestamp (seconds)
- `type` — `"input"` or `"output"`
- `data` — base64-encoded terminal data
- `hash` — SHA-256 hash chain for integrity verification

On session close, logs are compressed with `xz` (preferred) or `gzip`.
