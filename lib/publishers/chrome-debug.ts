import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

async function isDebugSessionReady(debugUrl: string) {
  try {
    const response = await fetch(new URL("/json/version", debugUrl), { signal: AbortSignal.timeout(1200), cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

function chromeExecutable() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
}

export async function ensureChromeDebugSession(debugUrl: string) {
  if (await isDebugSessionReady(debugUrl)) return { launched: false };

  let target: URL;
  try {
    target = new URL(debugUrl);
  } catch {
    throw new Error("Chrome 디버깅 주소 형식이 올바르지 않습니다. 연결 설정에서 http://127.0.0.1:9222로 저장해 주세요.");
  }
  if (!["127.0.0.1", "localhost"].includes(target.hostname)) {
    throw new Error("설정한 Chrome 디버깅 주소에 연결할 수 없습니다. 연결 설정에서 주소를 확인해 주세요.");
  }

  const executable = chromeExecutable();
  const localAppData = process.env.LOCALAPPDATA;
  if (!executable || !localAppData) {
    throw new Error("Google Chrome을 찾지 못했습니다. Chrome을 설치한 뒤 다시 시도해 주세요.");
  }

  const port = target.port || "9222";
  const profileDirectory = path.join(localAppData, "NaverContentStudioChrome");
  const chrome = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    "--new-window",
    "about:blank",
  ], { detached: true, stdio: "ignore", windowsHide: false });
  chrome.unref();

  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await isDebugSessionReady(debugUrl)) return { launched: true };
  }

  throw new Error("콘텐츠 스튜디오용 Chrome을 열었지만 연결하지 못했습니다. 열린 Chrome 창을 확인한 뒤 다시 눌러 주세요.");
}
