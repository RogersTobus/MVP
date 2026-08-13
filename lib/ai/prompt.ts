import type { GenerateInput, GeneratedArticle } from "./types";

const guardrails = `
중요 원칙:
- 제공되지 않은 사실, 통계, 후기, 의료 효과를 지어내지 마세요.
- 검색이나 외부 도구를 사용하지 마세요. 주어진 정보만 사용하세요.
- 광고·의료 관련 보장성 표현, 공포 조장, 과장 표현을 피하세요.
- 결과 외의 설명은 쓰지 마세요.
`.trim();

export function buildArticlePrompt(input: GenerateInput) {
  return `당신은 한국어 네이버 블로그 콘텐츠 에디터입니다.

[전체 공통 메모리]
${input.globalMemory || "없음"}

[카테고리]
${input.categoryName}

[카테고리 메모리]
${input.categoryMemory || "없음"}

[이번 글 주제]
${input.topic}

[추가 지시]
${input.extraInstructions || "없음"}

[문체]
- 보고서처럼 딱딱한 ‘~합니다’ 문장을 연속해서 쓰지 말고, 독자에게 설명해 주는 자연스러운 해요체를 중심으로 작성하세요.
- 정확성과 신뢰를 유지하되 ‘~할 수 있어요’, ‘~부터 살펴볼게요’, ‘~인지 확인해 보세요’처럼 문장을 부드럽게 연결하세요.
- 억지 공감, 과한 감탄, 유행어, 지나친 친근함은 피하고 차분하고 따뜻한 온도를 유지하세요.
- 핵심 정보와 주의사항은 부드러운 말투 때문에 흐려지지 않게 분명히 작성하세요.

[글 구조]
${input.blocks.map((b, index) => `${index + 1}. ${b.label} (${b.type})\n지시: ${b.instruction || "자연스럽게 작성"}`).join("\n\n")}

[이미지 블록 작성 규칙]
- type이 image인 블록의 text에는 본문 문단 대신 해당 위치에 필요한 이미지의 구체적인 시각 묘사와 생성 지침을 작성하세요.
- image 블록의 지시문과 앞뒤 글 맥락을 반영하되, 이미지 안에 글자나 로고를 넣지 마세요.

${guardrails}

아래 JSON 형식으로만 답하세요. blocks는 이미지 블록을 포함해 입력 구조와 같은 순서와 개수여야 합니다.
{"title":"제목","summary":"2문장 이내 요약","blocks":[{"type":"intro","label":"도입","text":"본문"}]}`;
}

export function buildRegeneratePrompt(input: GenerateInput & { currentTitle: string; targetIndex: number; currentBlocks: GeneratedArticle["blocks"] }) {
  const target = input.blocks[input.targetIndex];
  return `한국어 네이버 블로그 글의 한 블록만 다시 작성하세요.

[전체 공통 메모리]
${input.globalMemory || "없음"}
[카테고리 메모리]
${input.categoryMemory || "없음"}
[글 주제] ${input.topic}
[현재 제목] ${input.currentTitle}
[대상 블록] ${target.label} (${target.type})
[대상 지시] ${target.instruction || "자연스럽게 작성"}
[앞뒤 맥락]
${input.currentBlocks.map((b, i) => `${i + 1}. ${b.label}: ${i === input.targetIndex ? "[다시 작성할 부분]" : b.text}`).join("\n")}
[추가 지시] ${input.extraInstructions || "없음"}

[문체]
- 앞뒤 블록의 어투와 맞추고, 딱딱한 보고서 문장보다 자연스러운 해요체로 부드럽게 설명하세요.
- 억지 공감이나 과한 감탄 없이 차분하고 친절하게 쓰되 핵심 정보는 분명히 남기세요.

${guardrails}
아래 JSON 형식으로만 답하세요: {"text":"새 블록 본문"}`;
}

export function parseJson<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Codex 응답에서 JSON을 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
