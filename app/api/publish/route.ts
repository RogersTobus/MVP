import { NextResponse } from "next/server";
import { contentInclude, db } from "@/lib/db";
import { NaverPublisher } from "@/lib/publishers/naver";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const [settings, content] = await Promise.all([
    db.appSetting.findUniqueOrThrow({ where: { id: 1 } }),
    db.content.findUniqueOrThrow({ where: { id: Number(body.contentId) }, include: contentInclude }),
  ]);
  try {
    const result = await new NaverPublisher(settings.naverBlogId, settings.chromeDebugUrl).prepareDraft({ title: content.title, body: content.blocks.filter((block) => block.type !== "image").map((block) => block.text).join("\n\n") });
    await db.content.update({ where: { id: content.id }, data: { status: result.status === "ready" ? "publish_ready" : "draft", publishNote: result.message } });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "게시 준비에 실패했습니다." }, { status: 500 });
  }
}
