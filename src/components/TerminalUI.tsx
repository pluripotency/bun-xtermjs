import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

interface TerminalUIProps {
  token: string;
  onDisconnect: (reason?: string) => void;
}

export function TerminalUI({ token, onDisconnect }: TerminalUIProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"PlemolJP Console NF", "JetBrainsMono Nerd Font Mono", monospace',
      theme: {
        background: "#1e1e1e",
      }
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    let isMounted = true;
    let ws: WebSocket | null = null;
    let fitTimeout: ReturnType<typeof setTimeout>;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/terminal/ws?token=${encodeURIComponent(token)}`;
    ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMounted) return;
      
      // Delay initialization until we are sure the connection isn't immediately closed 
      // by the server's single-user lock rejection (which triggers xterm internal crashes)
      setTimeout(() => {
        if (!isMounted || ws?.readyState !== WebSocket.OPEN) return;
        
        if (terminalRef.current && !term.element) {
          term.open(terminalRef.current);
          term.focus();
          term.writeln("Connected to terminal.");
          
          fitTimeout = setTimeout(() => {
            try {
              if (isMounted) {
                fitAddon.fit();
                if (ws?.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
                }
              }
            } catch (e) {
              console.error("Fit error on load:", e);
            }
          }, 50);
        }
      }, 50);
    };

    ws.onmessage = (event) => {
      if (!isMounted) return;
      term.write(event.data);
    };

    ws.onclose = (event) => {
      if (!isMounted) return;
      if (term.element) {
        term.writeln(`\r\nConnection closed. ${event.reason || ""}`);
      }
      onDisconnect(event.reason);
    };

    term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
    
    const handleResize = () => {
      try {
        if (isMounted && term.element) fitAddon.fit();
      } catch (e) {
        // ignore fit error
      }
      if (ws?.readyState === WebSocket.OPEN && term.element) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    window.addEventListener("resize", handleResize);

    // Attach the resize cleanup to a custom property to run in the teardown
    (term as any)._resizeHandler = handleResize;

    return () => {
      isMounted = false;
      clearTimeout(fitTimeout);
      const resizeHandler = (term as any)._resizeHandler;
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
      }
      if (ws) {
        ws.close();
      }
      term.dispose();
    };
  }, [token, onDisconnect]);

  return (
    <div className="w-full h-full bg-[#1e1e1e] overflow-hidden p-0 m-0 text-left">
      <div ref={terminalRef} className="w-full h-full" />
    </div>
  );
}
