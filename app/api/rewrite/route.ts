import { NextResponse } from "next/server";
import { createAiAdapter } from "@/lib/ai";
import { contentInclude, db, getContentImages, parseImageReferences, parseImageReferenceSources } from "@/lib/db";
import { formatBlogBlockText } from "@/lib/content-format";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const [settings, content] = await Promise.all([
      db.appSetting.findUniqueOrThrow({ where: { id: 1 } }),
      db.content.findUniqueOrThrow({ where: { id: Number(body.contentId) }, include: contentInclude }),
    ]);
    const lengthMode = ["short", "standard", "deep"].includes(body.lengthMode) ? body.lengthMode as "short" | "standard" | "deep" : "short";
    const input = {
      globalMemory: settings.globalMemory,
      categoryName: content.category.name,
      categoryMemory: content.category.memory,
      topic: content.topic,
      extraInstructions: [content.extraInstructions, "기존 글에서 반복되는 설명을 걷어내고 핵심 정보만 남겨 네이버 모바일에서 빠르게 읽히게 다시 작성합니다."].filter(Boolean).join("\n"),
      lengthMode,
      blocks: content.blocks.map(({ type, label, instruction }) => ({ type, label, instruction })),
    };
    const generated = await createAiAdapter(settings).generate(input);
    const formatted = generated.blocks.map((block, index) => input.blocks[index]?.type === "image" ? block : { ...block, text: formatBlogBlockText(block.text) });
    await db.$transaction([
      ...content.blocks.map((block, index) => db.contentBlock.update({ where: { id: block.id }, data: { label: formatted[index]?.label?.trim() || block.label, text: formatted[index]?.text || "" } })),
      db.content.update({ where: { id: content.id }, data: { title: generated.title, summary: generated.summary, body: formatted.filter((_, index) => input.blocks[index]?.type !== "image").map((block) => block.text).join("\n\n"), status: "draft" } }),
    ]);
    const updated = await db.content.findUniqueOrThrow({ where: { id: content.id }, include: contentInclude });
    const imageReferences = parseImageReferences(updated.imageReferences);
    return NextResponse.json({ ...updated, images: await getContentImages(updated.id), imageReferences, imageReferenceSources: parseImageReferenceSources(updated.imageReferenceSources, imageReferences) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "글을 짧게 다시 쓰지 못했습니다." }, { status: 500 });
  }
}
