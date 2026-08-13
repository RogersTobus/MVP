import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolveCliCommand } from "@/lib/cli-command";

function splitArgs(value: string) {
  return [...value.matchAll(/(?:[^\s"]+|"[^"]*")+/g)].map((match) => match[0].replace(/^"|"$/g, ""));
}

function run(command: string, args: string[], prompt: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true, shell: false, env: process.env });
    let errorText = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("이미지 생성 시간이 초과되었습니다.")); }, 600_000);
    child.stderr.on("data", (chunk) => (errorText += chunk.toString()));
    child.on("error", (error) => { clearTimeout(timer); reject(new Error(`이미지 생성 CLI를 실행할 수 없습니다: ${error.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`이미지 생성이 중단되었습니다. ${errorText.trim().slice(-500)}`));
    });
    child.stdin.end(prompt);
  });
}

export class CodexImageCliAdapter {
  constructor(private command: string, private extraArgs: string) {}

  async generate(input: { title: string; topic: string; categoryName: string; summary: string; body: string; style: string; purpose: string; setIndex: number; setTotal: number; setPlan: string[]; referencePaths: string[]; imageInstructions?: string; outputPath: string }) {
    const styleGuide: Record<string, string> = {
      clean: "한국의 실제 현장에서 관찰해 촬영한 듯한 담백한 다큐멘터리 사진. 눈높이 시점, 약간 비대칭인 구도, 평범한 실내 조명과 절제된 색보정",
      photo: "스마트폰 또는 35mm 카메라로 자연스럽게 포착한 현실적인 현장 사진. 연출된 광고 사진보다 생활감과 구체적인 사물의 질감을 우선",
      illustration: "과장된 3D 캐릭터나 기업용 클립아트를 피한 차분한 편집 일러스트. 제한된 색상, 단순한 형태, 한 장면에 한 가지 개념",
      infographic: "정확한 정보 구조를 시각적으로 암시하는 단순한 도식형 이미지. 가짜 수치·차트·문자 없이 관계와 순서만 표현",
    };
    const prompt = `imagegen 스킬과 이미지 생성 도구를 사용해 블로그용 래스터 이미지를 1장 생성하세요.

글 제목: ${input.title}
주제: ${input.topic}
카테고리: ${input.categoryName}
요약: ${input.summary}
현재 이미지: 전체 ${input.setTotal}장 중 ${input.setIndex + 1}번째
현재 이미지의 역할: ${input.purpose}
전체 이미지 구성:
${input.setPlan.map((role, index) => `${index + 1}. ${role}`).join("\n")}
레퍼런스 이미지 절대 경로:
${input.referencePaths.length ? input.referencePaths.map((reference, index) => `${index + 1}. ${reference}`).join("\n") : "없음"}
스타일: ${styleGuide[input.style] || styleGuide.clean}
사용자 이미지 생성 지침: ${input.imageInstructions?.trim() || "별도 지침 없음"}
본문 참고: ${input.body.slice(0, 3000)}

요구사항:
- 레퍼런스 이미지가 있으면 먼저 각 파일을 직접 열어 확인하고, 사용자가 참고시키려는 피사체·구도·색감·공간·장비 중 현재 역할에 적합한 요소를 반영하세요.
- 레퍼런스를 그대로 복제하지 말고 글의 주제와 현재 이미지 역할에 맞게 새 장면으로 구성하세요. 인물의 신원, 로고, 개인정보, 읽을 수 있는 문구는 재현하지 마세요.
- 가장 먼저 제목과 주제에서 직접 다루는 핵심 대상, 신체 부위, 검사, 도구 또는 공간을 찾으세요. 운영·상담 장면보다 그 핵심 대상을 우선해 시각화하세요.
- 의료 주제가 특정 신체 부위나 검사·시술을 다루면 해당 부위의 자연스러운 외관, 관련된 일상적 검사 장비, 비침습적 검사 준비·과정을 우선하세요. 수술 장면이나 내부 해부 구조는 정확성을 확신할 때만 사용하세요.
- 예를 들어 스마일라식 주제라면 눈의 자연스러운 근접 사진, 안과 검사 장비, 환자가 비침습적 시력·각막 검사를 받는 옆모습, 안경이나 렌즈 같은 준비 맥락을 우선하고 상담 장면은 전체 세트에서 최대 1장만 허용하세요.
- 현재 이미지의 역할을 지키고, 전체 구성의 다른 번호와 같은 상담 책상·서류 검토·사람 배치를 반복하지 마세요.
- 제목의 추상적인 키워드를 상징물로 표현하지 말고, 본문에서 실제로 일어날 법한 한 장면을 선택하세요.
- 여러 요소를 한 화면에 억지로 넣지 말고 한 이미지에는 하나의 분명한 장면과 시선의 중심만 두세요.
- 정면 중앙 대칭, 과도한 보케, 영화 같은 역광, 청록·주황 색보정, 비현실적으로 반짝이는 표면 등 전형적인 AI 광고 이미지 문법을 피하세요.
- 사람이 필요하지 않으면 공간, 손, 도구, 문서, 화면을 바라보는 뒷모습처럼 맥락을 보여주는 요소를 우선하세요.
- 사람이 등장하면 카메라를 보며 웃는 포즈, 과도하게 매끈한 피부, 부자연스러운 손과 치아, 획일적인 외모를 피하세요.
- 화면이나 문서는 내용이 읽히지 않는 자연스러운 상태로 표현하고 가짜 UI, 가짜 차트, 떠다니는 아이콘을 만들지 마세요.
- 이미지 안에 글자, 로고, 워터마크를 넣지 마세요.
- 사용자 이미지 생성 지침이 있으면 기본 스타일보다 우선해 반영하세요. 단, 안전 원칙과 사실성 원칙은 유지하세요.
- 사람의 얼굴이나 의료 장면이 필요하면 자연스럽고 존중하는 표현을 사용하세요.
- 글에 없는 구체적인 제품, 치료 결과, 수치나 주장을 시각적으로 만들어내지 마세요.
- 반드시 PNG 래스터 이미지로 생성하세요.
- 최종 이미지를 정확히 다음 절대 경로에 저장하세요: ${input.outputPath}
- 다른 파일을 수정하지 마세요.
- 저장을 완료한 뒤 짧게 완료 여부만 답하세요.`;
    await run(await resolveCliCommand(this.command), ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", ...splitArgs(this.extraArgs), "-"], prompt);
    try { await access(input.outputPath); } catch { throw new Error("Codex CLI에서 이미지 생성 도구를 사용할 수 없거나 결과 파일을 저장하지 못했습니다. CLI에 imagegen 스킬과 이미지 생성 도구가 연결되어 있는지 확인해 주세요."); }
    const header = await readFile(input.outputPath).then((buffer) => buffer.subarray(0, 8));
    if (header.length < 8 || header[0] !== 0x89 || header[1] !== 0x50 || header[2] !== 0x4e || header[3] !== 0x47) {
      throw new Error("생성된 결과가 PNG 이미지 형식이 아닙니다.");
    }
  }
}
