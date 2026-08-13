import { NextResponse } from "next/server";
import { mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { db, getContentImages, parseImageReferences } from "@/lib/db";
import { CodexImageCliAdapter } from "@/lib/images/codex-image-cli";
import { collectNaverImageReferences } from "@/lib/references/naver-image-search";
import { curateImageReferences } from "@/lib/references/codex-reference-curator";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: Request) {
  const body = await request.json();
  const requestedCount = Math.min(5, Math.max(1, Number(body.count) || 1));
  const batchTotal = Math.min(5, Math.max(requestedCount, Number(body.batchTotal) || requestedCount));
  const batchIndex = Math.min(batchTotal - 1, Math.max(0, Number(body.batchIndex) || 0));
  const effectiveCount = Math.min(requestedCount, batchTotal - batchIndex);
  const imageInstructions = String(body.imageInstructions || "").trim().slice(0, 5000);
  const style = ["clean", "photo", "illustration", "infographic"].includes(body.style) ? body.style : "clean";
  const [settings, content] = await Promise.all([
    db.appSetting.findUniqueOrThrow({ where: { id: 1 } }),
    db.content.findUniqueOrThrow({ where: { id: Number(body.contentId) }, include: { category: true, blocks: { orderBy: { sortOrder: "asc" } } } }),
  ]);
  const outputDir = path.join(process.cwd(), "public", "generated");
  await mkdir(outputDir, { recursive: true });
  const adapter = new CodexImageCliAdapter(settings.cliCommand, settings.cliExtraArgs);
  let referenceUrls = parseImageReferences(content.imageReferences).filter((url) => existsSync(path.join(process.cwd(), "public", "references", path.basename(url))));
  if (settings.autoWebReferences && batchIndex === 0 && referenceUrls.length < 5) {
    try {
      const webCandidates = await collectNaverImageReferences({ topic: content.topic, debugUrl: settings.chromeDebugUrl, limit: 20 });
      const candidatePaths = webCandidates.map((url) => path.join(process.cwd(), "public", "references", path.basename(url)));
      let selectedPaths: string[] = [];
      try {
        selectedPaths = await curateImageReferences({
          command: settings.cliCommand,
          extraArgs: settings.cliExtraArgs,
          topic: content.topic,
          title: content.title,
          categoryName: content.category.name,
          candidatePaths,
          limit: 5 - referenceUrls.length,
        });
      } catch (error) {
        console.warn("[web-image-reference] AI 선별 실패, 검색 순서 기준으로 대체합니다.", error);
        selectedPaths = candidatePaths.slice(0, 5 - referenceUrls.length);
      }
      const selectedSet = new Set(selectedPaths.map((candidate) => path.resolve(candidate)));
      await Promise.all(candidatePaths.filter((candidate) => !selectedSet.has(path.resolve(candidate))).map((candidate) => unlink(candidate).catch(() => undefined)));
      const selectedUrls = selectedPaths.map((candidate) => `/references/${path.basename(candidate)}`);
      referenceUrls = [...new Set([...referenceUrls, ...selectedUrls])].slice(0, 5);
      await db.content.update({ where: { id: content.id }, data: { imageReferences: JSON.stringify(referenceUrls) } });
    } catch (error) {
      console.warn("[web-image-reference] 자동 수집을 건너뜁니다.", error);
    }
  }
  const referencePaths = referenceUrls.map((url) => path.join(process.cwd(), "public", "references", path.basename(url)));
  const combinedImageInstructions = [...new Set([
    settings.globalImageMemory,
    content.category.imageMemory,
    content.imageInstructions,
    imageInstructions,
  ].map((value) => value.trim()).filter(Boolean))].join("\n\n");
  const imageBlocks = content.blocks.filter((block) => block.type === "image");
  const setRoles = [
    "주제 직접 묘사: 제목의 핵심 대상·신체 부위·검사·도구를 한눈에 알 수 있는 대표 장면",
    "검사·관찰·작업 장면: 주제와 직접 연결된 장비나 과정을 옆 또는 뒤에서 자연스럽게 포착",
    "세부 근접 장면: 주제와 관련된 신체 부위, 사물 또는 도구의 현실적인 질감과 디테일",
    "준비·생활 맥락: 독자가 실제로 준비하거나 확인할 물건과 환경을 보여주는 장면",
    "보조 맥락: 앞선 장면과 겹치지 않는 공간 또는 행동. 상담 장면은 꼭 필요할 때만 사용",
  ];
  const buildPlacement = (index: number) => {
    if (!imageBlocks.length) return { order: -1, purpose: setRoles[index] };
    const block = imageBlocks[index % imageBlocks.length];
    const variant = Math.floor(index / imageBlocks.length) + 1;
    return { order: block.sortOrder, purpose: `${setRoles[index]} / 템플릿 위치 ‘${block.label}’: ${block.instruction || block.text || "앞뒤 내용을 직접 보조하는 이미지"}${variant > 1 ? ` (추가 시안 ${variant}, 이전 시안과 다른 피사체와 구도)` : ""}` };
  };
  const setPlan = Array.from({ length: batchTotal }, (_, index) => buildPlacement(index).purpose);
  const placements = Array.from({ length: effectiveCount }, (_, index) => ({ ...buildPlacement(batchIndex + index), setIndex: batchIndex + index }));
  try {
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      const filename = `content-${content.id}-${Date.now()}-${placement.setIndex + 1}.png`;
      const outputPath = path.join(outputDir, filename);
      const prompt = `${content.title} — ${placement.purpose}`;
      await adapter.generate({ title: content.title, topic: content.topic, categoryName: content.category.name, summary: content.summary, body: content.blocks.map((block) => `${block.label}: ${block.text}`).join("\n\n"), style, purpose: placement.purpose, setIndex: placement.setIndex, setTotal: batchTotal, setPlan, referencePaths, imageInstructions: combinedImageInstructions, outputPath });
      await db.$executeRawUnsafe(`INSERT INTO "ContentImage" ("contentId", "prompt", "url", "style", "placementOrder") VALUES (?, ?, ?, ?, ?)`, content.id, prompt, `/generated/${filename}`, style, placement.order);
    }
    return NextResponse.json({ images: await getContentImages(content.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "이미지 생성에 실패했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const body = await request.json();
  await db.$executeRawUnsafe(`DELETE FROM "ContentImage" WHERE "id" = ?`, Number(body.imageId));
  return NextResponse.json({ ok: true });
}
