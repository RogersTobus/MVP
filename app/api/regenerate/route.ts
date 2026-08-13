import { NextResponse } from "next/server";
import { createAiAdapter } from "@/lib/ai";
import { contentInclude, db, parseImageReferences, parseImageReferenceSources } from "@/lib/db";
import { formatBlogBlockText } from "@/lib/content-format";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = await request.json();
  const [settings, content] = await Promise.all([
    db.appSetting.findUniqueOrThrow({ where: { id: 1 } }),
    db.content.findUniqueOrThrow({ where: { id: Number(body.contentId) }, include: contentInclude }),
  ]);
  const targetIndex = content.blocks.findIndex((block) => block.id === Number(body.blockId));
  if (targetIndex < 0) return NextResponse.json({ error: "블록을 찾지 못했습니다." }, { status: 404 });
  try {
    const result = await createAiAdapter(settings).regenerateBlock({
      globalMemory: settings.globalMemory,
      categoryName: content.category.name,
      categoryMemory: content.category.memory,
      topic: content.topic,
      extraInstructions: body.instruction?.trim() || content.extraInstructions,
      blocks: content.blocks.map(({ type, label, instruction }) => ({ type, label, instruction })),
      currentTitle: content.title,
      targetIndex,
      currentBlocks: content.blocks.map(({ type, label, text }) => ({ type, label, text })),
    });
    await db.contentBlock.update({ where: { id: Number(body.blockId) }, data: { text: formatBlogBlockText(result.text) } });
    const refreshed = await db.content.findUniqueOrThrow({ where: { id: content.id }, include: contentInclude });
    const updated = await db.content.update({ where: { id: content.id }, data: { body: refreshed.blocks.filter((block) => block.type !== "image").map((block) => block.text).join("\n\n") }, include: contentInclude });
    const imageReferences = parseImageReferences(updated.imageReferences);
    return NextResponse.json({ ...updated, imageReferences, imageReferenceSources: parseImageReferenceSources(updated.imageReferenceSources, imageReferences) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "블록 재생성에 실패했습니다." }, { status: 500 });
  }
}
