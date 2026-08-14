import { NextResponse } from "next/server";
import { createAiAdapter } from "@/lib/ai";
import { db, ensureSeed } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    await ensureSeed();
    const body = await request.json();
    const kind = body.kind === "ads" ? "ads" : "cardnews";
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return NextResponse.json({ error: "만들고 싶은 내용을 프롬프트에 입력해 주세요." }, { status: 400 });
    const settings = await db.appSetting.findUniqueOrThrow({ where: { id: 1 } });
    const itemCount = Math.max(3, Math.min(kind === "cardnews" ? 10 : 6, Number(body.itemCount) || (kind === "cardnews" ? 7 : 4)));
    const destination = ["canva", "instagram", "export"].includes(body.destination) ? body.destination : "canva";
    const result = await createAiAdapter(settings).generateCreativePlan({ kind, prompt, itemCount, destination, ratio: String(body.ratio || "1:1"), referenceCount: Math.max(0, Math.min(8, Number(body.referenceCount) || 0)) });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "제작 기획안을 만들지 못했습니다." }, { status: 500 });
  }
}
