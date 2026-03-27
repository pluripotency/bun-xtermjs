import os from "os";

export const config = {
  port: process.env.PORT || 3000,
  TERMINAL_PASSWORD: process.env.TERMINAL_PASSWORD || "secret",
  shell: os.platform() === "win32" ? "powershell.exe" : "bash",
};
