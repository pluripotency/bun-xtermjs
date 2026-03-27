import { useState } from "react";
import { TerminalAuth } from "./components/TerminalAuth";
import { TerminalUI } from "./components/TerminalUI";
import { Button } from "@/components/ui/button";
import "./index.css";

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="w-screen h-screen relative bg-[#1e1e1e]">
      <div className="absolute top-2 right-4 z-[100]">
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
