import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

interface TerminalLogViewProps {
  token: string;
  onBack: () => void;
  onDisconnect: () => void;
}

type ReplayStatus = "idle" | "loading" | "playing" | "paused" | "done" | "error";

const SPEED_OPTIONS = [
  { label: "1×", value: 1 },
  { label: "2×", value: 2 },
  { label: "5×", value: 5 },
  { label: "10×", value: 10 },
  { label: "50×", value: 50 },
];

export function TerminalLogView({ token, onBack, onDisconnect }: TerminalLogViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<ReplayStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Initialize xterm once
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: false,
      fontFamily: '"PlemolJP Console NF", "JetBrainsMono Nerd Font Mono", monospace',
      disableStdin: true,
      theme: {
        background: "#1a1b26",
        foreground: "#a9b1d6",
        cursor: "#c0caf5",
        selectionBackground: "#33467c",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Delay open() until the container has been laid out by the browser
    const rafId = requestAnimationFrame(() => {
      if (!terminalRef.current) return;
      term.open(terminalRef.current);

      setTimeout(() => {
        try { fitAddon.fit(); } catch {}
      }, 50);

      term.writeln("\x1b[2m── Select a log file and press Play to start replay ──\x1b[0m");
    });

    const handleResize = () => {
      try { fitAddon.fit(); } catch {}
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleResize);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Fetch log file list
  useEffect(() => {
    fetch(`/api/logs?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((files: string[]) => {
        setLogFiles(files);
        if (files.length > 0 && files[0] !== undefined) setSelectedFile(files[0]);
      })
      .catch(() => setLogFiles([]));
  }, [token]);

  // Start replay
  const startReplay = useCallback(() => {
    if (!selectedFile || !termRef.current) return;

    // Close any existing replay WS
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Clear terminal
    termRef.current.reset();
    setStatus("loading");
    setErrorMsg("");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/logs/replay?file=${encodeURIComponent(selectedFile)}&token=${encodeURIComponent(token)}&speed=${speed}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("playing");
    };

    ws.onmessage = (event) => {
      // Check for control messages
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "done") {
          setStatus("done");
          return;
        }
        if (msg.type === "error") {
          setStatus("error");
          setErrorMsg(msg.message || "Unknown error");
          return;
        }
      } catch {
        // Not JSON — it's terminal data
      }

      termRef.current?.write(event.data);
    };

    ws.onclose = (event) => {
      if (status !== "done" && status !== "error") {
        if (event.code === 1000) {
          setStatus("done");
        } else if (event.code === 4004) {
          setStatus("error");
          setErrorMsg("Log file not found");
        }
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setErrorMsg("WebSocket connection error");
    };
  }, [selectedFile, token, speed, status]);

  // Pause / Resume replay
  const togglePause = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (status === "playing") {
      ws.send(JSON.stringify({ type: "pause" }));
      setStatus("paused");
    } else if (status === "paused") {
      ws.send(JSON.stringify({ type: "resume" }));
      setStatus("playing");
    }
  }, [status]);

  // Stop replay
  const stopReplay = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("idle");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const isActive = status === "playing" || status === "loading" || status === "paused";

  const statusLabel = {
    idle: "",
    loading: "Connecting…",
    playing: "▶ Replaying",
    paused: "⏸ Paused",
    done: "✓ Replay complete",
    error: `✕ ${errorMsg}`,
  }[status];

  const statusColor = {
    idle: "",
    loading: "text-yellow-400",
    playing: "text-green-400",
    paused: "text-orange-400",
    done: "text-blue-400",
    error: "text-red-400",
  }[status];

  return (
    <div className="w-full h-full flex flex-col bg-[#1a1b26]">
      {/* Control bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-[#16161e] border-b border-[#292e42] flex-shrink-0">
        {/* Terminal button */}
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#292e42] text-[#9ece6a] hover:bg-[#33467c] transition-colors"
        >
          🖥 Terminal
        </button>

        {/* Disconnect */}
        <button
          onClick={onDisconnect}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#292e42] text-[#f7768e] hover:bg-[#33467c] transition-colors"
        >
          Log Out
        </button>

        <div className="w-px h-5 bg-[#292e42]" />

        {/* Log file selector */}
        <select
          value={selectedFile}
          onChange={(e) => setSelectedFile(e.target.value)}
          disabled={isActive}
          className="px-2 py-1.5 text-xs rounded-md bg-[#292e42] text-[#a9b1d6] border border-[#3b4261] focus:border-[#7aa2f7] focus:outline-none disabled:opacity-50 max-w-[280px] truncate"
        >
          {logFiles.length === 0 && <option value="">No log files found</option>}
          {logFiles.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        {/* Speed selector */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[#565f89] uppercase tracking-wider">Speed</span>
          <div className="flex rounded-md overflow-hidden border border-[#3b4261]">
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSpeed(opt.value)}
                disabled={isActive}
                className={`px-2 py-1 text-[11px] font-mono transition-colors ${
                  speed === opt.value
                    ? "bg-[#7aa2f7] text-[#1a1b26] font-bold"
                    : "bg-[#292e42] text-[#a9b1d6] hover:bg-[#33467c]"
                } disabled:opacity-50`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="w-px h-5 bg-[#292e42]" />

        {/* Play / Pause / Stop */}
        {!isActive ? (
          <button
            onClick={startReplay}
            disabled={!selectedFile || logFiles.length === 0}
            className="px-4 py-1.5 text-xs font-medium rounded-md bg-[#9ece6a] text-[#1a1b26] hover:bg-[#73daca] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ▶ Play
          </button>
        ) : (
          <div className="flex gap-1.5">
            {/* Pause / Resume */}
            <button
              onClick={togglePause}
              disabled={status === "loading"}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ${
                status === "paused"
                  ? "bg-[#e0af68] text-[#1a1b26] hover:bg-[#ffc777]"
                  : "bg-[#7aa2f7] text-[#1a1b26] hover:bg-[#82aaff]"
              }`}
            >
              {status === "paused" ? "▶ Resume" : "⏸ Pause"}
            </button>
            {/* Stop */}
            <button
              onClick={stopReplay}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#f7768e] text-[#1a1b26] hover:bg-[#ff9e64] transition-colors"
            >
              ■ Stop
            </button>
          </div>
        )}

        {/* Status */}
        {statusLabel && (
          <span className={`text-xs font-mono ${statusColor} ml-auto ${
            status === "playing" || status === "loading" ? "animate-pulse" : ""
          }`}>
            {statusLabel}
          </span>
        )}
      </div>

      {/* Terminal */}
      <div className="flex-1 overflow-hidden p-0 m-0">
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  );
}
