import { PrismaClient } from "@prisma/client";
import path from "node:path";
import defaultGuides from "./default-guides.json";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

const starterCategories = defaultGuides.categories.map((category) => ({
  name: category.name,
  memory: category.memory.join("\n"),
  imageMemory: category.imageMemory.join("\n"),
  color: category.color,
}));

const starterBlocks = [
  ["intro", "도입", "독자의 상황을 한 문단으로 포착하고 글에서 얻을 내용을 분명히 안내합니다."],
  ["empathy", "공감", "독자가 겪는 현실적인 고민을 구체적인 장면으로 표현합니다."],
  ["problem", "문제 제기", "흔한 오해나 놓치기 쉬운 문제를 과장 없이 짚습니다."],
  ["core", "핵심 정보", "실행 가능한 핵심 내용을 소제목과 함께 체계적으로 설명합니다."],
  ["conclusion", "결론", "핵심을 짧게 정리하고 다음 행동으로 자연스럽게 연결합니다."],
  ["cta", "CTA", "부담스럽지 않은 한 문장 행동 제안을 작성합니다."],
] as const;

async function ensureGuidanceColumns() {
  try { await db.$executeRawUnsafe(`ALTER TABLE "AppSetting" ADD COLUMN "globalImageMemory" TEXT NOT NULL DEFAULT ''`); } catch { /* Column already exists. */ }
  try { await db.$executeRawUnsafe(`ALTER TABLE "Category" ADD COLUMN "imageMemory" TEXT NOT NULL DEFAULT ''`); } catch { /* Column already exists. */ }
  try { await db.$executeRawUnsafe(`ALTER TABLE "Content" ADD COLUMN "imageInstructions" TEXT NOT NULL DEFAULT ''`); } catch { /* Column already exists. */ }
  try { await db.$executeRawUnsafe(`ALTER TABLE "Content" ADD COLUMN "imageReferences" TEXT NOT NULL DEFAULT '[]'`); } catch { /* Column already exists. */ }
  try { await db.$executeRawUnsafe(`ALTER TABLE "Content" ADD COLUMN "imageReferenceSources" TEXT NOT NULL DEFAULT '[]'`); } catch { /* Column already exists. */ }
  try { await db.$executeRawUnsafe(`ALTER TABLE "Content" ADD COLUMN "hashtags" TEXT NOT NULL DEFAULT '[]'`); } catch { /* Column already exists. */ }
  try { await db.$executeRawUnsafe(`ALTER TABLE "AppSetting" ADD COLUMN "autoWebReferences" BOOLEAN NOT NULL DEFAULT true`); } catch { /* Column already exists. */ }
}

export type StoredPersona = { id: number; name: string; instruction: string; createdAt: string; updatedAt: string };

export async function ensurePersonaTable() {
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Persona" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL UNIQUE,
    "instruction" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

export async function getPersonas() {
  await ensurePersonaTable();
  return db.$queryRawUnsafe<StoredPersona[]>(`SELECT * FROM "Persona" ORDER BY "createdAt" ASC, "id" ASC`);
}

export type StoredPersonaResearch = {
  id: number;
  name: string;
  keywords: string;
  targetCount: number;
  sampledCount: number;
  status: "queued" | "collecting" | "analyzing" | "completed" | "failed";
  summary: string;
  error: string;
  personaId: number | null;
  createdAt: string;
  updatedAt: string;
};

export async function ensurePersonaResearchTables() {
  await ensurePersonaTable();
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PersonaResearch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "targetCount" INTEGER NOT NULL DEFAULT 100,
    "sampledCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "summary" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "personaId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonaResearch_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`);
  try { await db.$executeRawUnsafe(`ALTER TABLE "PersonaResearch" ADD COLUMN "summary" TEXT NOT NULL DEFAULT ''`); } catch { /* Column already exists. */ }
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PersonaResearchSource" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "researchId" INTEGER NOT NULL,
    "blogId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonaResearchSource_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "PersonaResearch"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`);
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "PersonaResearchSource_researchId_blogId_key" ON "PersonaResearchSource"("researchId", "blogId")`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PersonaResearch_status_updatedAt_idx" ON "PersonaResearch"("status", "updatedAt")`);
}

export async function ensureSeed() {
  await ensureGuidanceColumns();
  await ensurePersonaTable();
  await ensurePersonaResearchTables();
  await db.appSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1, globalMemory: defaultGuides.globalMemory.join("\n"), globalImageMemory: defaultGuides.globalImageMemory.join("\n") } });
  if ((await db.category.count()) === 0) {
    await db.category.createMany({ data: starterCategories });
  }
  if ((await db.template.count()) === 0) {
    await db.template.create({
      data: {
        name: "기본 정보형 글",
        description: "공감에서 핵심 정보와 행동 제안으로 이어지는 기본 구조",
        blocks: { create: starterBlocks.map(([type, label, instruction], sortOrder) => ({ type, label, instruction, sortOrder })) },
      },
    });
  }
  const medicalDepthRule = "[의료 정보 깊이] ‘병원에 문의하세요’, ‘상담을 받아보세요’로 설명을 대신하지 않습니다. 신뢰 가능한 자료를 바탕으로 원리, 검사 이유, 대상 판단 요소, 진행 과정, 회복, 한계와 주의사항을 독자가 이해할 만큼 먼저 설명하고, 의료진 확인 안내는 마지막에 짧게 덧붙입니다. 도입에서 핵심 답을 먼저 주고 용어 정의 → 작동 원리 → 기존 방식과의 차이 → 독자에게 갖는 의미 순서로 풉니다. 최신 장비나 빠른 속도를 더 좋은 결과와 동일시하지 않으며, 병원 자랑과 CTA가 정보 설명을 덮지 않게 합니다.";
  const medicalCategories = await db.category.findMany({ where: { name: { in: ["병원 마케팅", "병원·진료 정보"] } } });
  await Promise.all(medicalCategories.filter((category) => !category.memory.includes("[의료 정보 깊이]")).map((category) => db.category.update({ where: { id: category.id }, data: { memory: `${category.memory.trim()}\n${medicalDepthRule}` } })));
}

export const contentInclude = {
  category: true,
  blocks: { orderBy: { sortOrder: "asc" as const } },
};

export function parseImageReferences(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.startsWith("/references/")).slice(0, 5) : [];
  } catch { return []; }
}

export function normalizeHashtags(value: unknown, fallback: string[] = []): string[] {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : fallback;
  const normalized = [...new Set(source.map((item) => String(item).trim().replace(/^#+/, "").replace(/[^0-9A-Za-z가-힣_]/g, "")).filter(Boolean))].slice(0, 8);
  return normalized.length || fallback.length === 0 ? normalized : normalizeHashtags(fallback);
}

export function buildTopicHashtags(topic: string, title = ""): string[] {
  const subject = `${topic} ${title}`.trim();
  const domainTags = /스마일라식|라식|라섹|시력교정|안과|눈\s*건강/i.test(subject)
    ? ["스마일라식", "라식", "라섹", "시력교정", "시력교정술", "안과", "안과검사", "눈건강"]
    : /병원|의료|진료|시술|수술|질환|검사/i.test(subject)
      ? [topic, "건강정보", "의료정보", "병원정보", "검사정보", "치료정보", "건강관리", "진료정보"]
      : /투자|주식|재테크|자산|경제/i.test(subject)
        ? [topic, "투자", "재테크", "자산관리", "경제", "주식", "투자공부", "경제공부"]
        : /경영|MBA|비즈니스|사업|창업|COO|재무/i.test(subject)
          ? [topic, "경영", "비즈니스", "MBA", "기업경영", "경영전략", "조직관리", "재무관리"]
          : /AI|인공지능|자동화|코딩|바이브코딩/i.test(subject)
            ? [topic, "AI", "인공지능", "업무자동화", "생성형AI", "AI활용", "바이브코딩", "자동화"]
            : [topic, `${topic}정보`, `${topic}가이드`, `${topic}비교`, `${topic}추천`, `${topic}팁`, `${topic}정리`, `${topic}방법`];
  return normalizeHashtags(domainTags);
}

export function completeTopicHashtags(value: unknown, topic: string, title = ""): string[] {
  return normalizeHashtags([...normalizeHashtags(value), ...buildTopicHashtags(topic, title)]);
}

export function parseHashtags(value: string, fallback: string[] = []) {
  try { return normalizeHashtags(JSON.parse(value), fallback); } catch { return normalizeHashtags(value, fallback); }
}

export type ImageReferenceSource = {
  url: string;
  kind: "manual" | "web";
  sourcePageUrl?: string;
  originalImageUrl?: string;
  title?: string;
};

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

export function parseImageReferenceSources(value: string, references: string[]): ImageReferenceSource[] {
  let parsed: unknown = [];
  try { parsed = JSON.parse(value); } catch { /* Older content has no source metadata. */ }
  const stored = Array.isArray(parsed) ? parsed : [];
  return references.map((url) => {
    const match = stored.find((item) => item && typeof item === "object" && (item as { url?: unknown }).url === url) as Record<string, unknown> | undefined;
    const inferredKind = path.basename(url).startsWith("web-") ? "web" : "manual";
    return {
      url,
      kind: match?.kind === "web" || match?.kind === "manual" ? match.kind : inferredKind,
      ...(isHttpUrl(match?.sourcePageUrl) ? { sourcePageUrl: match.sourcePageUrl } : {}),
      ...(isHttpUrl(match?.originalImageUrl) ? { originalImageUrl: match.originalImageUrl } : {}),
      ...(typeof match?.title === "string" && match.title.trim() ? { title: match.title.trim().slice(0, 200) } : {}),
    };
  });
}

export type StoredContentImage = {
  id: number;
  contentId: number;
  prompt: string;
  url: string;
  style: string;
  placementOrder: number;
  createdAt: string;
};

export async function ensureImageTable() {
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ContentImage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contentId" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "style" TEXT NOT NULL DEFAULT 'clean',
    "placementOrder" INTEGER NOT NULL DEFAULT -1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentImage_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`);
  try { await db.$executeRawUnsafe(`ALTER TABLE "ContentImage" ADD COLUMN "placementOrder" INTEGER NOT NULL DEFAULT -1`); } catch { /* Column already exists. */ }
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ContentImage_contentId_createdAt_idx" ON "ContentImage"("contentId", "createdAt")`);
}

export async function getContentImages(contentId?: number) {
  await ensureImageTable();
  if (contentId) return db.$queryRawUnsafe<StoredContentImage[]>(`SELECT * FROM "ContentImage" WHERE "contentId" = ? ORDER BY "createdAt" ASC`, contentId);
  return db.$queryRawUnsafe<StoredContentImage[]>(`SELECT * FROM "ContentImage" ORDER BY "createdAt" ASC`);
}
