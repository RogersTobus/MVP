import { NextResponse } from "next/server";
import { contentInclude, db, ensureSeed, getContentImages, parseImageReferences } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  await ensureSeed();
  const [settings, categories, templates, contents, images] = await Promise.all([
    db.appSetting.findUniqueOrThrow({ where: { id: 1 } }),
    db.category.findMany({ orderBy: { createdAt: "asc" } }),
    db.template.findMany({ include: { blocks: { orderBy: { sortOrder: "asc" } } }, orderBy: { updatedAt: "desc" } }),
    db.content.findMany({ include: contentInclude, orderBy: { createdAt: "desc" } }),
    getContentImages(),
  ]);
  return NextResponse.json({ settings, categories, templates, contents: contents.map((content) => ({ ...content, imageReferences: parseImageReferences(content.imageReferences), images: images.filter((image) => image.contentId === content.id) })) });
}
