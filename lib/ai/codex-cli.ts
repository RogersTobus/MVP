import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveCliCommand } from "@/lib/cli-command";
import { buildArticlePrompt, buildRegeneratePrompt, parseJson } from "./prompt";
import type { AiAdapter, GenerateInput, GeneratedArticle } from "./types";

function splitArgs(value: string) {
  return [...value.matchAll(/(?:[^\s"]+|"[^"]*")+/g)].map((m) => m[0].replace(/^"|"$/g, ""));
}

function runProcess(command: string, args: string[], input?: string, timeoutMs = 240_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true, shell: false, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Codex CLI 응답 시간이 초과되었습니다."));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (error) => { clearTimeout(timer); reject(new Error(`Codex CLI를 실행할 수 없습니다: ${error.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Codex CLI가 종료 코드 ${code}로 끝났습니다. ${stderr.trim()}`));
    });
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

export class CodexCliAdapter implements AiAdapter {
  constructor(private command = "codex", private extraArgs = "") {}

  private async run(prompt: string, schema: object) {
    const dir = await mkdtemp(path.join(tmpdir(), "content-studio-"));
    const outputFile = path.join(dir, "result.txt");
    const schemaFile = path.join(dir, "schema.json");
    try {
      await writeFile(schemaFile, JSON.stringify(schema), "utf8");
      const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-schema", schemaFile, "--output-last-message", outputFile, ...splitArgs(this.extraArgs), "-"];
      const result = await runProcess(await resolveCliCommand(this.command), args, prompt);
      try { return await readFile(outputFile, "utf8"); } catch { return result.stdout; }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async generate(input: GenerateInput) {
    const schema = {
      type: "object", additionalProperties: false, required: ["title", "summary", "blocks"],
      properties: {
        title: { type: "string" }, summary: { type: "string" },
        blocks: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "label", "text"], properties: { type: { type: "string" }, label: { type: "string" }, text: { type: "string" } } } },
      },
    };
    const result = parseJson<GeneratedArticle>(await this.run(buildArticlePrompt(input), schema));
    if (!result.title || !result.summary || !Array.isArray(result.blocks) || result.blocks.length !== input.blocks.length) {
      throw new Error("Codex 응답 형식이 올바르지 않습니다. 다시 생성해 주세요.");
    }
    return result;
  }

  async regenerateBlock(input: GenerateInput & { currentTitle: string; targetIndex: number; currentBlocks: GeneratedArticle["blocks"] }) {
    const schema = { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } };
    const result = parseJson<{ text: string }>(await this.run(buildRegeneratePrompt(input), schema));
    if (!result.text) throw new Error("새 블록 본문이 비어 있습니다.");
    return result;
  }

  async test() {
    const result = await runProcess(await resolveCliCommand(this.command), ["--version", ...splitArgs(this.extraArgs)], undefined, 15_000);
    return result.stdout.trim() || result.stderr.trim() || "Codex CLI 연결 성공";
  }
}
