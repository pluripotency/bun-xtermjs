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

interface TimelineEvent {
  rel: number;
  type: "input" | "output";
}

interface TimelineData {
  duration: number;
  firstT: number;
  events: TimelineEvent[];
}

const SPEED_OPTIONS = [
  { label: "1×", value: 1 },
  { label: "2×", value: 2 },
  { label: "5×", value: 5 },
  { label: "10×", value: 10 },
  { label: "50×", value: 50 },
];

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TerminalLogView({ token, onBack, onDisconnect }: TerminalLogViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timelineBarRef = useRef<HTMLDivElement>(null);

  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<ReplayStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Timeline state
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [seekRel, setSeekRel] = useState(0);        // 0–1: where to start from
  const [playheadRel, setPlayheadRel] = useState(0); // 0–1: current replay position
  const [isDragging, setIsDragging] = useState(false);
  const [hoverRel, setHoverRel] = useState<number | null>(null);
  const [wasPlayingBeforeDrag, setWasPlayingBeforeDrag] = useState(false);

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

    const rafId = requestAnimationFrame(() => {
      if (!terminalRef.current) return;
      term.open(terminalRef.current);
      setTimeout(() => { try { fitAddon.fit(); } catch {} }, 50);
      term.writeln("\x1b[2m── Select a log file and press Play to start replay ──\x1b[0m");
    });

    const handleResize = () => { try { fitAddon.fit(); } catch {} };
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

  // Fetch timeline when file changes
  useEffect(() => {
    if (!selectedFile) return;
    setTimeline(null);
    setSeekRel(0);
    setPlayheadRel(0);
    setTimelineLoading(true);
    fetch(`/api/logs/timeline?file=${encodeURIComponent(selectedFile)}&token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data: TimelineData) => setTimeline(data))
      .catch(() => setTimeline(null))
      .finally(() => setTimelineLoading(false));
  }, [selectedFile, token]);

  // --- Timeline drag helpers ---

  const getRelFromClientX = useCallback((clientX: number): number => {
    const bar = timelineBarRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const stopCurrentReplay = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // --- Replay controls ---

  const startReplay = useCallback((targetRel?: number, startPaused: boolean = false) => {
    if (!selectedFile || !termRef.current) return;

    const relToUse = targetRel !== undefined ? targetRel : seekRel;

    stopCurrentReplay();

    termRef.current.reset();
    setStatus("loading");
    setErrorMsg("");
    setPlayheadRel(relToUse); // fast-forward will restore state instantly

    const startOffset = timeline ? relToUse * timeline.duration : 0;
    const duration    = timeline?.duration ?? 0;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/logs/replay` +
      `?file=${encodeURIComponent(selectedFile)}` +
      `&token=${encodeURIComponent(token)}` +
      `&speed=${speed}` +
      `&startOffset=${startOffset}` +
      `&duration=${duration}` +
      (startPaused ? `&paused=true` : ``);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setStatus(startPaused ? "paused" : "playing");

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "done") {
          setStatus("done");
          setPlayheadRel(1);
          return;
        }
        if (msg.type === "progress") {
          if (duration > 0) setPlayheadRel(msg.rel);
          return;
        }
        if (msg.type === "error") {
          setStatus("error");
          setErrorMsg(msg.message || "Unknown error");
          return;
        }
      } catch {
        // Not JSON — terminal data
      }
      termRef.current?.write(event.data);
    };

    ws.onclose = (event) => {
      if (event.code === 1000) {
        setStatus((s) => s === "playing" || s === "paused" ? "done" : s);
        setPlayheadRel(1);
      } else if (event.code === 4004) {
        setStatus("error");
        setErrorMsg("Log file not found");
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setErrorMsg("WebSocket connection error");
    };
  }, [selectedFile, token, speed, seekRel, timeline, stopCurrentReplay]);

  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rel = getRelFromClientX(e.clientX);
    setSeekRel(rel);
    setIsDragging(true);
    setWasPlayingBeforeDrag(status === "playing");
    stopCurrentReplay();
    setStatus("idle");
    setPlayheadRel(rel);
  }, [getRelFromClientX, stopCurrentReplay, status]);

  // Global mouse move + up for drag
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const rel = getRelFromClientX(e.clientX);
      setSeekRel(rel);
      setPlayheadRel(rel);
    };
    const onUp   = (e: MouseEvent) => {
      const rel = getRelFromClientX(e.clientX);
      setSeekRel(rel);
      setIsDragging(false);
      startReplay(rel, !wasPlayingBeforeDrag);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [isDragging, getRelFromClientX, startReplay, wasPlayingBeforeDrag]);

  // Pause / Resume
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
    stopCurrentReplay();
    setStatus("idle");
  }, [stopCurrentReplay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopCurrentReplay(); };
  }, [stopCurrentReplay]);

  const isActive = status === "playing" || status === "loading" || status === "paused";

  const statusLabel: Record<ReplayStatus, string> = {
    idle:    "",
    loading: "Connecting…",
    playing: "▶ Replaying",
    paused:  "⏸ Paused",
    done:    "✓ Replay complete",
    error:   `✕ ${errorMsg}`,
  };

  const statusColor: Record<ReplayStatus, string> = {
    idle:    "",
    loading: "text-yellow-400",
    playing: "text-green-400",
    paused:  "text-orange-400",
    done:    "text-blue-400",
    error:   "text-red-400",
  };

  const seekTime = timeline ? seekRel * timeline.duration : 0;

  return (
    <div className="w-full h-full flex flex-col bg-[#1a1b26]">

      {/* ── Control bar ── */}
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
          onChange={(e) => { setSelectedFile(e.target.value); stopCurrentReplay(); setStatus("idle"); }}
          disabled={isActive}
          className="px-2 py-1.5 text-xs rounded-md bg-[#292e42] text-[#a9b1d6] border border-[#3b4261] focus:border-[#7aa2f7] focus:outline-none disabled:opacity-50 max-w-[280px] truncate"
        >
          {logFiles.length === 0 && <option value="">No log files found</option>}
          {logFiles.map((f) => (
            <option key={f} value={f}>{f}</option>
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
            onClick={() => startReplay()}
            disabled={!selectedFile || logFiles.length === 0}
            className="px-4 py-1.5 text-xs font-medium rounded-md bg-[#9ece6a] text-[#1a1b26] hover:bg-[#73daca] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ▶ Play
          </button>
        ) : (
          <div className="flex gap-1.5">
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
            <button
              onClick={stopReplay}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#f7768e] text-[#1a1b26] hover:bg-[#ff9e64] transition-colors"
            >
              ■ Stop
            </button>
          </div>
        )}

        {/* Status */}
        {statusLabel[status] && (
          <span className={`text-xs font-mono ${statusColor[status]} ml-auto ${
            status === "playing" || status === "loading" ? "animate-pulse" : ""
          }`}>
            {statusLabel[status]}
          </span>
        )}
      </div>

      {/* ── Timeline ── */}
      <div className="px-3 py-1.5 bg-[#13131a] border-b border-[#292e42] flex items-center gap-2 flex-shrink-0 select-none">
        {/* Seek time label */}
        <span className="text-[10px] font-mono text-[#a9b1d6] w-[36px] text-right flex-shrink-0">
          {formatTime(seekTime)}
        </span>

        {/* Timeline bar */}
        {timelineLoading ? (
          <div className="flex-1 h-4 flex items-center">
            <div className="w-full h-[4px] rounded-full bg-[#292e42] animate-pulse" />
          </div>
        ) : (
          <div
            ref={timelineBarRef}
            className="relative flex-1 h-[28px] cursor-pointer"
            onMouseDown={handleTimelineMouseDown}
            onMouseMove={(e) => { if (!isDragging) setHoverRel(getRelFromClientX(e.clientX)); }}
            onMouseLeave={() => { if (!isDragging) setHoverRel(null); }}
          >
            {/* Track background */}
            <div className="absolute left-0 right-0 top-[12px] h-[4px] rounded-full bg-[#292e42]" />

            {/* Playhead fill */}
            <div
              className="absolute top-[12px] h-[4px] rounded-full bg-[#7aa2f7]/40 pointer-events-none"
              style={{ width: `${playheadRel * 100}%` }}
            />

            {/* Event markers */}
            {timeline?.events.map((ev, i) => (
              <div
                key={i}
                className="absolute pointer-events-none"
                style={{
                  left: `${ev.rel * 100}%`,
                  top: "8px",
                  height: "12px",
                  width: "1px",
                  background: ev.type === "output" ? "#7aa2f7" : "#9ece6a",
                  opacity: 0.4,
                }}
              />
            ))}

            {/* Seek cursor line */}
            <div
              className="absolute top-[6px] h-[16px] w-[2px] rounded-full bg-white/80 pointer-events-none"
              style={{ left: `${seekRel * 100}%`, transform: "translateX(-50%)" }}
            />

            {/* Seek handle dot */}
            <div
              className={`absolute w-[12px] h-[12px] rounded-full border-2 pointer-events-none transition-transform ${
                isDragging ? "bg-white border-[#7aa2f7] scale-125" : "bg-white border-[#292e42]"
              }`}
              style={{
                left: `${seekRel * 100}%`,
                top: "8px",
                transform: "translateX(-50%)",
              }}
            />

            {/* Hover tooltip */}
            {hoverRel !== null && !isDragging && timeline && (
              <div
                className="absolute -top-5 px-1 py-0.5 text-[9px] font-mono bg-[#24283b] text-[#a9b1d6] rounded pointer-events-none whitespace-nowrap shadow"
                style={{ left: `${hoverRel * 100}%`, transform: "translateX(-50%)" }}
              >
                {formatTime(hoverRel * timeline.duration)}
              </div>
            )}

            {/* Drag tooltip */}
            {isDragging && timeline && (
              <div
                className="absolute -top-5 px-1 py-0.5 text-[9px] font-mono bg-[#7aa2f7] text-[#1a1b26] rounded pointer-events-none whitespace-nowrap shadow font-bold"
                style={{ left: `${seekRel * 100}%`, transform: "translateX(-50%)" }}
              >
                {formatTime(seekRel * timeline.duration)}
              </div>
            )}
          </div>
        )}

        {/* Total duration label */}
        <span className="text-[10px] font-mono text-[#565f89] w-[36px] flex-shrink-0">
          {formatTime(timeline?.duration ?? 0)}
        </span>
      </div>

      {/* ── Terminal ── */}
      <div className="flex-1 overflow-hidden p-0 m-0">
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  );
}
