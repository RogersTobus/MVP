import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function resolveCliCommand(command: string) {
  const configured = command.trim() || "codex";
  if (configured.toLowerCase() !== "codex" && configured.toLowerCase() !== "codex.exe") return configured;
  if (process.platform !== "win32") return configured;

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return configured;
  const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  try {
    const directories = await readdir(binRoot, { withFileTypes: true });
    const candidates: Array<{ file: string; modified: number }> = [];
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const file = path.join(binRoot, directory.name, "codex.exe");
      try {
        await access(file);
        candidates.push({ file, modified: (await stat(file)).mtimeMs });
      } catch { /* This runtime folder does not contain the CLI. */ }
    }
    candidates.sort((left, right) => right.modified - left.modified);
    return candidates[0]?.file || configured;
  } catch {
    return configured;
  }
}
