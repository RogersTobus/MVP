import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveCliCommand } from "@/lib/cli-command";
import { buildArticlePrompt, buildRegeneratePrompt, needsMedicalResearch, parseJson } from "./prompt";
import type { AiAdapter, GenerateInput, GeneratedArticle, PersonaStyleSample } from "./types";

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

  private async run(prompt: string, schema: object, enableSearch = false, timeoutMs = 240_000) {
    const dir = await mkdtemp(path.join(tmpdir(), "content-studio-"));
    const outputFile = path.join(dir, "result.txt");
    const schemaFile = path.join(dir, "schema.json");
    try {
      await writeFile(schemaFile, JSON.stringify(schema), "utf8");
      const args = [...(enableSearch ? ["--search"] : []), "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-schema", schemaFile, "--output-last-message", outputFile, ...splitArgs(this.extraArgs), "-"];
      const result = await runProcess(await resolveCliCommand(this.command), args, prompt, timeoutMs);
      try { return await readFile(outputFile, "utf8"); } catch { return result.stdout; }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async generate(input: GenerateInput) {
    const schema = {
      type: "object", additionalProperties: false, required: ["title", "summary", "hashtags", "blocks"],
      properties: {
        title: { type: "string" }, summary: { type: "string" },
        hashtags: { type: "array", minItems: 5, maxItems: 10, items: { type: "string" } },
        blocks: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "label", "text"], properties: { type: { type: "string" }, label: { type: "string" }, text: { type: "string" } } } },
      },
    };
    let result = parseJson<GeneratedArticle>(await this.run(buildArticlePrompt(input), schema, needsMedicalResearch(input.categoryName)));
    if (!result.title || !result.summary || !Array.isArray(result.hashtags) || !Array.isArray(result.blocks) || result.blocks.length !== input.blocks.length) {
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

  async analyzePersona(input: { name: string; keywords: string; samples: PersonaStyleSample[] }) {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["instruction", "analysisSummary"],
      properties: {
        instruction: { type: "string" },
        analysisSummary: { type: "string" },
      },
    };
    const compactSamples = input.samples.map((sample, index) => ({
      no: index + 1,
      title: sample.title.slice(0, 120),
      text: sample.text.slice(0, 1400),
    }));
    const domain = `${input.name} ${input.keywords}`;
    const domainRules = /병원|의료|질환|시술|건강검진/.test(domain)
      ? "비의료인 편집자의 위치를 명시하고 의료인·환자 행세, 개인 진단, 치료 보장, 허위 시술 경험을 금지합니다. '상담하세요'로 본문 설명을 대신하지 말고 확인 가능한 일반 원리와 판단 요소를 충분히 설명한 뒤 개인 진단 영역만 짧게 구분합니다."
      : /투자|주식|자산|기업 분석|경제/.test(domain)
        ? "사실·가정·해석을 구분하고 기준 시점과 불확실성, 반대 시나리오, 손실 위험을 함께 적게 합니다. 수익 보장, 매수·매도 선동, 허위 보유·수익 경험, 사후 확신을 금지합니다."
        : /경영|MBA|비즈니스|사업|대표|창업/.test(domain)
          ? "제공되지 않은 대표·창업·조직 운영 경험을 1인칭 성공담으로 만들지 않습니다. 개념을 실제 의사결정 기준과 적용 조건으로 연결하고 허세, 성공 신화, 만능 공식, 근거 없는 매출 수치를 금지합니다."
          : "제공되지 않은 경력이나 체험을 만들지 않고 사실과 개인 체감을 구분합니다.";
    const prompt = `네이버 블로그 공개 글 ${input.samples.length}개의 표현 특성을 분석해 '${input.name}' 페르소나용 글쓰기 지침을 만드세요.

[연구 키워드]
${input.keywords}

[분야별 필수 기준]
${domainRules}

[중요 원칙]
- 특정 작성자 한 명의 고유 문체를 복제하지 말고 여러 작성자에게 반복되는 고수준 패턴만 종합합니다.
- 원문의 문장이나 고유 표현을 그대로 인용하거나 재사용하지 않습니다.
- 블로그명, 작성자명, URL, 개인 신상은 지침에 넣지 않습니다.
- 검색 상위 노출을 품질의 절대적 증거로 취급하지 말고, 광고성·과장·복붙형 패턴은 배제합니다.
- 자연스러움만 흉내 내다가 정보 밀도가 떨어지지 않게 합니다.

[instruction 작성 조건]
- 실제 글 생성 프롬프트에 그대로 붙일 수 있는 명령문으로 1,500~3,500자 작성합니다.
- 관점과 전문성 범위, 독자와 관계, 도입 방식, 문장 길이와 말끝, 문단과 줄바꿈, 소제목, 질문과 감탄, 이모지와 기호, 사례 방식, 정보 설명 순서, 제품·장소 언급, CTA, 금지 표현을 구체적으로 정합니다.
- '친근하게', '자연스럽게' 같은 추상어만 쓰지 말고 빈도와 위치, 좋은 방식과 나쁜 방식을 행동 규칙으로 적습니다.
- 분석 대상에서 반복된 장점만 채택하고 어색한 유행어, 억지 감탄, 과도한 이모지, 허위 체험은 금지합니다.
- 주제에 대한 사실 조사와 페르소나의 목소리를 구분하며, 모르는 사실을 경험담처럼 만들지 않게 합니다.
- 페르소나는 문체와 설명 방식을 정하는 역할만 하므로 웹 검색이나 외부 도구 사용 자체를 명령하지 않습니다. 사실 확인은 콘텐츠 생성 단계에 제공된 자료와 카테고리별 도구 정책을 따르게 합니다.

[analysisSummary 작성 조건]
- 어떤 요소를 채택하고 무엇을 버렸는지 500자 이내로 요약합니다.

[익명화된 분석 표본]
${JSON.stringify(compactSamples)}

JSON만 반환하세요.`;
    const result = parseJson<{ instruction: string; analysisSummary: string }>(await this.run(prompt, schema, false, 420_000));
    if (result.instruction.trim().length < 500) throw new Error("문체 분석 결과가 충분히 구체적이지 않습니다. 다시 시도해 주세요.");
    return { instruction: result.instruction.trim().slice(0, 5000), analysisSummary: result.analysisSummary.trim().slice(0, 1000) };
  }

  async test() {
    const result = await runProcess(await resolveCliCommand(this.command), ["--version", ...splitArgs(this.extraArgs)], undefined, 15_000);
    return result.stdout.trim() || result.stderr.trim() || "Codex CLI 연결 성공";
  }
}
