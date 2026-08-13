import type { GenerateInput, GeneratedArticle } from "./types";

const guardrails = `
중요 원칙:
- 제공되지 않은 사실, 통계, 후기, 의료 효과를 지어내지 마세요.
- 검색이나 외부 도구를 사용하지 마세요. 주어진 정보만 사용하세요.
- 광고·의료 관련 보장성 표현, 공포 조장, 과장 표현을 피하세요.
- 결과 외의 설명은 쓰지 마세요.
`.trim();

const medicalResearchRules = `
[의료 주제 리서치와 설명 깊이]
- 글을 쓰기 전에 웹 검색으로 정부·공공 의료기관, 관련 학회, 대학병원 등 신뢰할 수 있는 자료를 우선 확인하세요. 검색 결과의 광고성 문구나 한 병원의 주장만 근거로 삼지 마세요.
- 비의료인 편집자의 위치는 지키되 설명을 회피하지 마세요. 일반 독자가 이해할 수 있는 범위에서 시술·검사·질환의 원리, 왜 해당 검사를 하는지, 일반적으로 살피는 적합·부적합 요소, 진행 순서, 회복 과정, 한계와 주의사항, 비슷한 선택지와의 차이를 주제에 맞게 충분히 설명하세요.
- ‘개인마다 다릅니다’, ‘의료진과 상담하세요’, ‘병원에 문의하세요’만 반복하거나 그것으로 핵심 답변을 대신하지 마세요. 먼저 확인된 일반 정보를 구체적으로 설명한 뒤, 개인 진단이 필요한 부분만 분리해 마지막에 한두 문장으로 안내하세요.
- 숫자, 회복 기간, 대상 기준, 부작용 빈도처럼 출처에 따라 달라질 수 있는 내용은 근거가 확인된 범위에서만 쓰고 조건과 예외를 함께 밝히세요. 확인하지 못한 수치를 만들지 마세요.
- 결론은 막연한 상담 권유가 아니라 독자가 글을 읽고 얻은 핵심 판단 기준과 확인 항목을 정리하세요. 의료진에게 물어볼 질문은 본문 설명을 보완하는 수단이어야 하며 본문을 대체하면 안 됩니다.
- 독자가 읽은 뒤 ‘이게 이런 원리이고, 검사에서 무엇을 확인하며, 내 상황에서는 어떤 요소를 따져야 하는지 알겠다’고 느낄 정도의 정보 밀도를 확보하세요.

[설명이 잘되는 의료 블로그의 구성]
- 도입에서 독자가 실제로 궁금해하는 질문을 2~3개 짚고, 핵심 결론을 먼저 한 문단으로 답하세요. 결론을 숨긴 채 오래 끌지 마세요.
- 생소한 용어를 먼저 쉬운 말로 정의한 다음 ‘어떤 구조에 무엇을 하는지 → 그래서 기존 방식과 무엇이 달라지는지 → 독자에게 어떤 의미인지’ 순서로 연결하세요.
- 비교 주제라면 이름만 나열하지 말고 원리, 절개·처치 범위, 장비의 역할, 회복, 일반적으로 살피는 대상 조건, 한계를 같은 기준으로 맞춰 비교하세요.
- ‘최신’, ‘빠른 장비’, ‘미세 절개’ 같은 특성이 곧바로 더 좋은 최종 결과를 뜻한다고 비약하지 마세요. 편의성이나 보조 기능의 개선과 임상 결과의 우월성을 구분하세요.
- 검사 항목을 나열할 때는 무엇을 보는지뿐 아니라 그 결과가 어떤 판단에 쓰이는지도 한 문장씩 설명하세요.
- 본문의 대부분은 독자가 배우는 설명이어야 합니다. 병원·의료진·장비 자랑, 예약 안내, 상담 권유는 정보 설명을 대체할 수 없으며 CTA는 전체 글의 짧은 마무리로만 둡니다.
- 친근한 말투는 유지하되 ‘~였더라고요’, ‘~인 거죠’를 기계적으로 반복하거나 감탄사·이모지·과도한 느낌표로 신뢰감을 깎지 마세요.
`.trim();

export function needsMedicalResearch(categoryName: string) {
  return /병원|진료|의료/.test(categoryName);
}

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

${needsMedicalResearch(input.categoryName) ? medicalResearchRules : ""}

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
${needsMedicalResearch(input.categoryName) ? medicalResearchRules : ""}
아래 JSON 형식으로만 답하세요: {"text":"새 블록 본문"}`;
}

export function parseJson<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Codex 응답에서 JSON을 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
