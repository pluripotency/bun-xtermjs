import { useState } from "react";
import { TerminalAuth } from "./components/TerminalAuth";
import { TerminalUI } from "./components/TerminalUI";
import { TerminalLogView } from "./ui/TerminalLogView";
import { Button } from "@/components/ui/button";
import "./index.css";

type View = "terminal" | "logs";

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("terminal");

  if (!token) {
    return (
      <div className="flex flex-col items-center justify-center w-screen h-screen">
        <TerminalAuth 
          onAuthenticated={(t) => {
            setToken(t);
            setError(null);
          }} 
          initialError={error} 
        />
      </div>
    );
  }

  if (view === "logs") {
    return (
      <div className="w-screen h-screen relative bg-[#1a1b26]">
        <TerminalLogView
          token={token}
          onBack={() => setView("terminal")}
        />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen relative bg-[#1e1e1e]">
      <div className="absolute top-2 right-4 z-[100] flex gap-2">
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => setView("logs")}
          className="opacity-50 hover:opacity-100 transition-opacity bg-transparent border-[#565f89] text-[#7aa2f7] hover:bg-[#292e42] hover:text-[#7aa2f7]"
        >
          📋 Logs
        </Button>
        <Button 
          variant="destructive" 
          size="sm"
          onClick={() => setToken(null)}
          className="opacity-50 hover:opacity-100 transition-opacity"
        >
          Disconnect
        </Button>
      </div>
      <TerminalUI 
        token={token} 
        onDisconnect={(reason) => {
          setToken(null);
          setError(reason || "Connection failed or disconnected.");
        }} 
      />
    </div>
  );
}

export default App;
