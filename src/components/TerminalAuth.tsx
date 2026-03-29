import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface TerminalAuthProps {
  onAuthenticated: () => void;
  initialError?: string | null;
}

export function TerminalAuth({ onAuthenticated, initialError }: TerminalAuthProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError || "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError("Password is required");
      return;
    }
    setError("");
    
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: password }),
      });
      
      if (res.ok) {
        onAuthenticated();
      } else {
        setError("Invalid password");
      }
    } catch (err) {
      setError("Failed to connect to server");
    }
  };

  return (
    <div className="flex justify-center items-center min-h-[50vh]">
      <Card className="w-[400px]">
        <CardHeader>
          <CardTitle>Login</CardTitle>
          <CardDescription>Enter password to access session logs and terminal</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input 
              type="password" 
              placeholder="Password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit">Connect</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
