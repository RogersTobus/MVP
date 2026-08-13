import { NextResponse } from "next/server";
import { createAiAdapter } from "@/lib/ai";
import { db, ensureSeed } from "@/lib/db";

export async function PUT(request: Request) {
  await ensureSeed();
  const body = await request.json();
  const settings = await db.appSetting.update({
    where: { id: 1 },
    data: {
      globalMemory: body.globalMemory ?? "",
      globalImageMemory: body.globalImageMemory ?? "",
      cliCommand: body.cliCommand?.trim() || "codex",
      cliExtraArgs: body.cliExtraArgs ?? "",
      naverBlogId: body.naverBlogId?.trim() || "",
      chromeDebugUrl: body.chromeDebugUrl?.trim() || "http://127.0.0.1:9222",
      autoWebReferences: body.autoWebReferences !== false,
    },
  });
  return NextResponse.json(settings);
}

export async function POST() {
  await ensureSeed();
  const settings = await db.appSetting.findUniqueOrThrow({ where: { id: 1 } });
  try {
    return NextResponse.json({ ok: true, message: await createAiAdapter(settings).test() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "연결에 실패했습니다." }, { status: 500 });
  }
}
