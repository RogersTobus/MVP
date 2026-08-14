import { NextResponse } from "next/server";
import { contentInclude, db } from "@/lib/db";
import { getContentImages } from "@/lib/db";
import { NaverPublisher } from "@/lib/publishers/naver";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const [settings, content] = await Promise.all([
    db.appSetting.findUniqueOrThrow({ where: { id: 1 } }),
    db.content.findUniqueOrThrow({ where: { id: Number(body.contentId) }, include: contentInclude }),
  ]);
  try {
    const storedImages = await getContentImages(content.id);
    const generatedRoot = path.resolve(process.cwd(), "public", "generated");
    const usableImages = storedImages.flatMap((image) => {
      const imagePath = path.resolve(process.cwd(), "public", image.url.replace(/^\//, ""));
      return imagePath.startsWith(`${generatedRoot}${path.sep}`) && existsSync(imagePath) ? [{ ...image, imagePath }] : [];
    });
    const result = await new NaverPublisher(settings.naverBlogId, settings.chromeDebugUrl).prepareDraft({
      title: content.title,
      categoryName: content.category.name,
      coverImagePaths: usableImages.filter((image) => image.placementOrder < 0).map((image) => image.imagePath),
      blocks: content.blocks.map((block) => ({
        type: block.type,
        label: block.label,
        text: block.text,
        sortOrder: block.sortOrder,
        imagePaths: usableImages.filter((image) => image.placementOrder === block.sortOrder).map((image) => image.imagePath),
      })),
    });
    await db.content.update({ where: { id: content.id }, data: { status: result.status === "ready" ? "publish_ready" : "draft", publishNote: result.message } });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "게시 준비에 실패했습니다.";
    const friendlyMessage = /Target page, context or browser has been closed/i.test(message)
      ? "게시 준비 중 전용 Chrome 창이 닫혔습니다. Chrome 창을 열어 둔 상태에서 다시 시도해 주세요."
      : /intercepts pointer events|se-popup-dim/i.test(message)
        ? "네이버 편집기의 확인 팝업이 입력 화면을 가리고 있습니다. 열린 Chrome에서 팝업을 처리한 뒤 다시 시도해 주세요."
      : message;
    return NextResponse.json({ error: friendlyMessage }, { status: 500 });
  }
}
