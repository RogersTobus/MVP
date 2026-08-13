import { NextResponse } from "next/server";
import { contentInclude, db, parseImageReferences, parseImageReferenceSources } from "@/lib/db";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json();
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  const imageReferences = Array.isArray(body.imageReferences) ? body.imageReferences.filter((value: unknown) => typeof value === "string" && value.startsWith("/references/")).slice(0, 5) : [];
  const imageReferenceSources = parseImageReferenceSources(JSON.stringify(body.imageReferenceSources || []), imageReferences);
  const content = await db.content.update({
    where: { id: Number(id) },
    data: {
      categoryId: Number(body.categoryId),
      topic: body.topic,
      title: body.title,
      summary: body.summary ?? "",
      body: blocks.filter((block: { type: string }) => block.type !== "image").map((block: { text: string }) => block.text).join("\n\n"),
      extraInstructions: body.extraInstructions ?? "",
      imageInstructions: body.imageInstructions ?? "",
      imageReferences: JSON.stringify(imageReferences),
      imageReferenceSources: JSON.stringify(imageReferenceSources),
      status: body.status ?? "draft",
      blocks: {
        deleteMany: {},
        create: blocks.map((block: { type: string; label: string; instruction?: string; text?: string }, index: number) => ({ type: block.type, label: block.label, instruction: block.instruction || "", text: block.text || "", sortOrder: index })),
      },
    },
    include: contentInclude,
  });
  const parsedReferences = parseImageReferences(content.imageReferences);
  return NextResponse.json({ ...content, imageReferences: parsedReferences, imageReferenceSources: parseImageReferenceSources(content.imageReferenceSources, parsedReferences) });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await db.content.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
