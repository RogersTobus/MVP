import { PrismaClient } from "@prisma/client";
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
  try { await db.$executeRawUnsafe(`ALTER TABLE "AppSetting" ADD COLUMN "autoWebReferences" BOOLEAN NOT NULL DEFAULT true`); } catch { /* Column already exists. */ }
}

export async function ensureSeed() {
  await ensureGuidanceColumns();
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
