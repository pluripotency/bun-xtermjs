# Bun Web Terminal

A fast, lightweight, full-screen web-based terminal built with **Bun**, **React**, **Tailwind CSS**, and **xterm.js**. It leverages `bun-pty` to spawn a secure, native terminal session directly accessible via your web browser.

## Features

- ⚡️ **Blazing Fast**: Uses Bun's native HTTP server and WebSocket handling.
- 🎨 **Beautiful UI**: Full-screen, responsive terminal styled with standard xterm colors and a dark aesthetic.
- 🔒 **Single-User Lock**: Automatically prevents multiple users from accessing the terminal simultaneously, preventing command conflicts. If the terminal is in use, a secondary user is safely declined access until the first disconnects.
- 📏 **Automatic Resizing**: The terminal dynamically resizes the backend PTY columns and rows in real-time as you resize your browser window.
- ⌨️ **Instant Focus**: Seamless keyboard integration immediately focuses your cursor when you connect, letting you type commands natively without clicking. 
- 🛠️ **Cross-Platform Support**: Automatically detects your OS and uses `bash` for Linux/macOS or `powershell.exe` for Windows.

## Getting Started

### 1. Installation

Install all the necessary dependencies using Bun:
```bash
bun install
```

### 2. Configuration (Optional)
Application settings can be found in `src/config.ts`:

- **Port**: Default is `3000`
- **Shell**: Automatically defaults to your native environment
- **Password**: By default, the terminal uses `"secret"`. You can change this simply by setting a `TERMINAL_PASSWORD` environment variable before running.

### 3. Running the Server

Start the application with Bun's integrated bundler and development server:
```bash
bun dev
```

### 4. Usage

1. Open your browser and navigate to `http://localhost:3000`
2. Enter the terminal password (default is `secret`) and click **Connect**.
3. You will immediately be dropped into a fully interactive bash/powershell session!
4. Click **Disconnect** in the top right to safely terminate the session and unlock it for others.
