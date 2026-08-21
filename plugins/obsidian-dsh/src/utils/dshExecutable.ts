import * as fs from "fs";
import * as path from "path";

export interface DshDetection {
  command: string;
  args: string[];
  useShell: boolean;
}

export function resolveDshExecutable(explicit: string): DshDetection | null {
  if (explicit.trim()) {
    return { command: explicit.trim(), args: [], useShell: false };
  }

  const candidates: { command: string; args: string[]; useShell: boolean }[] = [];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    const nodeGlobal = appData ? path.join(appData, "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js") : null;
    if (nodeGlobal) {
      candidates.push({ command: process.execPath, args: [nodeGlobal], useShell: false });
    }
    if (programFiles) candidates.push({ command: path.join(programFiles, "nodejs", "dsh.cmd"), args: [], useShell: true });
    if (programFilesX86) candidates.push({ command: path.join(programFilesX86, "nodejs", "dsh.cmd"), args: [], useShell: true });
  } else {
    const npmGlobal = process.env.npm_config_prefix
      ? path.join(process.env.npm_config_prefix, "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
      : null;
    if (npmGlobal) candidates.push({ command: process.execPath, args: [npmGlobal], useShell: false });
    candidates.push({ command: "/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js", args: [], useShell: false });
    candidates.push({ command: "/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js", args: [], useShell: false });
    candidates.push({ command: "dsh", args: [], useShell: false });
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate.command) || candidate.command === "dsh") {
      return candidate;
    }
  }
  return null;
}
