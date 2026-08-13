import { NextResponse } from "next/server";
import { createAiAdapter } from "@/lib/ai";
import { contentInclude, db, ensureSeed, parseImageReferences, parseImageReferenceSources } from "@/lib/db";
import { formatBlogBlockText } from "@/lib/content-format";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    await ensureSeed();
    const body = await request.json();
    const categoryId = Number(body.categoryId);
    const templateId = Number(body.templateId);
    if (!Number.isInteger(categoryId) || !Number.isInteger(templateId)) {
      return NextResponse.json({ error: "카테고리와 글 구조를 다시 선택해 주세요." }, { status: 400 });
    }
    const [settings, category, template] = await Promise.all([
      db.appSetting.findUnique({ where: { id: 1 } }),
      db.category.findUnique({ where: { id: categoryId } }),
      db.template.findUnique({ where: { id: templateId }, include: { blocks: { orderBy: { sortOrder: "asc" } } } }),
    ]);
    if (!settings) return NextResponse.json({ error: "AI 설정을 찾지 못했습니다. 설정 화면에서 다시 저장해 주세요." }, { status: 404 });
    if (!category) return NextResponse.json({ error: "선택한 카테고리를 찾지 못했습니다." }, { status: 404 });
    if (!template || template.blocks.length === 0) return NextResponse.json({ error: "선택한 글 구조에 블록이 없습니다." }, { status: 404 });
    const input = {
      globalMemory: settings.globalMemory,
      categoryName: category.name,
      categoryMemory: category.memory,
      topic: String(body.topic || "").trim(),
      extraInstructions: String(body.extraInstructions || "").trim(),
      blocks: template.blocks.map(({ type, label, instruction }) => ({ type, label, instruction })),
    };
    if (!input.topic) return NextResponse.json({ error: "글 주제를 입력해 주세요." }, { status: 400 });
    const generated = await createAiAdapter(settings).generate(input);
    const formattedBlocks = generated.blocks.map((block, index) => input.blocks[index]?.type === "image" ? block : { ...block, text: formatBlogBlockText(block.text) });
    const imageReferences = Array.isArray(body.imageReferences) ? body.imageReferences.filter((value: unknown) => typeof value === "string" && value.startsWith("/references/")).slice(0, 5) : [];
    const imageReferenceSources = imageReferences.map((url: string) => ({ url, kind: "manual" as const, title: "사용자 제공 이미지" }));
    const content = await db.content.create({
      data: {
        categoryId: category.id,
        topic: input.topic,
        title: generated.title,
        summary: generated.summary,
        body: formattedBlocks.filter((_, index) => input.blocks[index]?.type !== "image").map((block) => block.text).join("\n\n"),
        extraInstructions: input.extraInstructions,
        imageInstructions: String(body.imageInstructions || "").trim(),
        imageReferences: JSON.stringify(imageReferences),
        imageReferenceSources: JSON.stringify(imageReferenceSources),
        blocks: { create: input.blocks.map((block, index) => ({ ...block, label: formattedBlocks[index]?.label?.trim() || block.label, text: formattedBlocks[index]?.text || "", sortOrder: index })) },
      },
      include: contentInclude,
    });
    const parsedReferences = parseImageReferences(content.imageReferences);
    return NextResponse.json({ ...content, imageReferences: parsedReferences, imageReferenceSources: parseImageReferenceSources(content.imageReferenceSources, parsedReferences) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "글 생성에 실패했습니다.";
    console.error("[content-generate]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
