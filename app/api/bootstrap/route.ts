import { NextResponse } from "next/server";
import { contentInclude, db, ensureSeed, getContentImages, getPersonas, parseHashtags, parseImageReferences, parseImageReferenceSources } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  await ensureSeed();
  const [settings, categories, templates, contents, images, personas] = await Promise.all([
    db.appSetting.findUniqueOrThrow({ where: { id: 1 } }),
    db.category.findMany({ orderBy: { createdAt: "asc" } }),
    db.template.findMany({ include: { blocks: { orderBy: { sortOrder: "asc" } } }, orderBy: { updatedAt: "desc" } }),
    db.content.findMany({ include: contentInclude, orderBy: { createdAt: "desc" } }),
    getContentImages(),
    getPersonas(),
  ]);
  return NextResponse.json({ settings, categories, templates, personas, contents: contents.map((content) => {
    const imageReferences = parseImageReferences(content.imageReferences);
    return { ...content, hashtags: parseHashtags(content.hashtags, [content.category.name, content.topic]), imageReferences, imageReferenceSources: parseImageReferenceSources(content.imageReferenceSources, imageReferences), images: images.filter((image) => image.contentId === content.id) };
  }) });
}
