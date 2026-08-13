import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveCliCommand } from "@/lib/cli-command";
import { buildArticlePrompt, buildRegeneratePrompt, needsMedicalResearch, parseJson } from "./prompt";
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

  private async run(prompt: string, schema: object, enableSearch = false) {
    const dir = await mkdtemp(path.join(tmpdir(), "content-studio-"));
    const outputFile = path.join(dir, "result.txt");
    const schemaFile = path.join(dir, "schema.json");
    try {
      await writeFile(schemaFile, JSON.stringify(schema), "utf8");
      const args = [...(enableSearch ? ["--search"] : []), "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-schema", schemaFile, "--output-last-message", outputFile, ...splitArgs(this.extraArgs), "-"];
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
    let result = parseJson<GeneratedArticle>(await this.run(buildArticlePrompt(input), schema, needsMedicalResearch(input.categoryName)));
    if (!result.title || !result.summary || !Array.isArray(result.blocks) || result.blocks.length !== input.blocks.length) {
      throw new Error("Codex 응답 형식이 올바르지 않습니다. 다시 생성해 주세요.");
    }
    const limits = { short: 1300, standard: 2000, deep: 3100 };
    const mode = input.lengthMode || "standard";
    const bodyLength = result.blocks.reduce((total, block, index) => total + (input.blocks[index]?.type === "image" ? 0 : block.text.length), 0);
    if (bodyLength > limits[mode]) {
      const target = mode === "short" ? "900~1,200자" : mode === "standard" ? "1,400~1,900자" : "2,200~3,000자";
      const condensePrompt = `아래 네이버 블로그 원고를 ${target}로 압축하세요.

절대 조건:
- blocks의 개수, 순서, type은 그대로 유지합니다.
- image 블록의 text는 그대로 유지합니다.
- 같은 설명과 결론의 반복, 불필요한 배경 설명, 막연한 권유부터 삭제합니다.
- 의료 글이라도 원리, 핵심 검사 이유, 판단 기준, 중요한 한계는 남기되 각각 한 번만 설명합니다.
- 문단은 짧게 유지하고 사실과 주의사항을 새로 만들지 않습니다.
- JSON 이외의 말은 쓰지 않습니다.

원고:
${JSON.stringify(result)}`;
      result = parseJson<GeneratedArticle>(await this.run(condensePrompt, schema, false));
    }
    const finalLength = result.blocks.reduce((total, block, index) => total + (input.blocks[index]?.type === "image" ? 0 : block.text.length), 0);
    if (finalLength > limits[mode]) throw new Error(`AI가 선택한 분량을 지키지 못했습니다. 현재 ${finalLength.toLocaleString()}자이며 목표 상한은 ${limits[mode].toLocaleString()}자입니다. 다시 생성해 주세요.`);
    return result;
  }

  async regenerateBlock(input: GenerateInput & { currentTitle: string; targetIndex: number; currentBlocks: GeneratedArticle["blocks"] }) {
    const schema = { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } };
    const result = parseJson<{ text: string }>(await this.run(buildRegeneratePrompt(input), schema, needsMedicalResearch(input.categoryName)));
    if (!result.text) throw new Error("새 블록 본문이 비어 있습니다.");
    return result;
  }

  async test() {
    const result = await runProcess(await resolveCliCommand(this.command), ["--version", ...splitArgs(this.extraArgs)], undefined, 15_000);
    return result.stdout.trim() || result.stderr.trim() || "Codex CLI 연결 성공";
  }
}
