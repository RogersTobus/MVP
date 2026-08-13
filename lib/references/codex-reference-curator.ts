import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveCliCommand } from "@/lib/cli-command";
import { parseJson } from "@/lib/ai/prompt";

function splitArgs(value: string) {
  return [...value.matchAll(/(?:[^\s"]+|"[^"]*")+/g)].map((match) => match[0].replace(/^"|"$/g, ""));
}

function runProcess(command: string, args: string[], prompt: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true, shell: false, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("이미지 레퍼런스 선별 시간이 초과되었습니다."));
    }, 300_000);
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`이미지 레퍼런스 선별 CLI를 실행하지 못했습니다: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`이미지 레퍼런스 선별이 중단되었습니다. ${stderr.trim().slice(-500)}`));
    });
    child.stdin.end(prompt);
  });
}

export async function curateImageReferences(input: {
  command: string;
  extraArgs: string;
  topic: string;
  title: string;
  categoryName: string;
  candidatePaths: string[];
  limit: number;
}) {
  const candidates = [...new Set(input.candidatePaths)].slice(0, 20);
  if (!candidates.length || input.limit <= 0) return [];

  const dir = await mkdtemp(path.join(tmpdir(), "content-studio-reference-"));
  const outputFile = path.join(dir, "selection.txt");
  const schemaFile = path.join(dir, "schema.json");
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["selected"],
    properties: {
      selected: {
        type: "array",
        maxItems: input.limit,
        items: { type: "string", enum: candidates },
      },
    },
  };

  const prompt = `아래 로컬 이미지 후보 ${candidates.length}장을 모두 실제로 열어 확인한 뒤, 블로그 이미지 생성의 레퍼런스로 가장 좋은 ${input.limit}장 이하를 고르세요.

카테고리: ${input.categoryName}
글 주제: ${input.topic}
글 제목: ${input.title}

후보 파일:
${candidates.map((candidate, index) => `${index + 1}. ${candidate}`).join("\n")}

선택 기준:
- 제목과 주제의 핵심 대상, 신체 부위, 검사 장비, 과정 또는 공간이 직접 보이는 사진을 우선합니다.
- 상담 장면처럼 어느 주제에나 붙일 수 있는 범용 사진은 핵심 대상 사진보다 뒤로 둡니다.
- 실제 촬영처럼 자연스럽고, 로고·워터마크·읽을 수 있는 문구·과도한 광고 연출이 없는 사진을 고릅니다.
- 거의 같은 피사체와 구도는 한 장만 고르고, 서로 다른 피사체·거리·시점으로 다양하게 구성합니다.
- 치료 결과나 효능을 단정하는 전후 사진, 불쾌하거나 침습적인 장면은 제외합니다.
- 어떤 후보도 기준에 맞지 않으면 억지로 개수를 채우지 않아도 됩니다.

파일을 수정하지 말고, 선택한 절대 경로만 JSON의 selected 배열로 반환하세요.`;

  try {
    await writeFile(schemaFile, JSON.stringify(schema), "utf8");
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--output-schema",
      schemaFile,
      "--output-last-message",
      outputFile,
      ...splitArgs(input.extraArgs),
      "-",
    ];
    const result = await runProcess(await resolveCliCommand(input.command), args, prompt);
    const raw = await readFile(outputFile, "utf8").catch(() => result.stdout);
    const parsed = parseJson<{ selected: string[] }>(raw);
    return [...new Set(parsed.selected)].filter((candidate) => candidates.includes(candidate)).slice(0, input.limit);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
