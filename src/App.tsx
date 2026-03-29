import { useState, useEffect } from "react";
import { TerminalAuth } from "./components/TerminalAuth";
import { TerminalUI } from "./components/TerminalUI";
import { TerminalLogView } from "./components/TerminalLogView";
import { Button } from "@/components/ui/button";
import "./index.css";

type View = "terminal" | "logs";

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("logs");

  useEffect(() => {
    fetch("/api/check")
      .then(res => {
        if (res.ok) setIsAuthenticated(true);
      })
      .catch(() => {})
      .finally(() => setIsChecking(false));
  }, []);

  const handleLogout = async () => {
    await fetch("/api/logout", { method: "POST" });
    setIsAuthenticated(false);
    setView("logs");
  };

  if (isChecking) {
    return <div className="w-screen h-screen bg-[#1a1b26] flex items-center justify-center text-white">Loading...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center w-screen h-screen bg-[#1a1b26]">
        <TerminalAuth 
          onAuthenticated={() => {
            setIsAuthenticated(true);
            setError(null);
          }} 
          initialError={error} 
        />
      </div>
    );
  }

  if (view === "terminal") {
    return (
      <div className="w-screen h-screen relative bg-[#1e1e1e]">
        <div className="absolute top-2 right-4 z-[100] flex gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setView("logs")}
            className="opacity-50 hover:opacity-100 transition-opacity bg-transparent border-[#565f89] text-[#7aa2f7] hover:bg-[#292e42] hover:text-[#7aa2f7]"
          >
            ← Logs
          </Button>
          <Button 
            variant="destructive" 
            size="sm"
            onClick={handleLogout}
            className="opacity-50 hover:opacity-100 transition-opacity"
          >
            Disconnect
          </Button>
        </div>
        <TerminalUI 
          onDisconnect={(reason) => {
            handleLogout();
            setError(reason || "Connection failed or disconnected.");
          }} 
        />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen relative bg-[#1a1b26]">
      <TerminalLogView
        onBack={() => setView("terminal")}
        onDisconnect={handleLogout}
      />
    </div>
  );
}

export default App;
