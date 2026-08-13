import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.name?.trim() || !Array.isArray(body.blocks) || body.blocks.length === 0) {
    return NextResponse.json({ error: "템플릿명과 한 개 이상의 블록이 필요합니다." }, { status: 400 });
  }
  const template = await db.template.create({
    data: {
      name: body.name.trim(),
      description: body.description?.trim() || "",
      blocks: { create: body.blocks.map((block: { type: string; label: string; instruction?: string }, index: number) => ({ ...block, instruction: block.instruction || "", sortOrder: index })) },
    },
    include: { blocks: { orderBy: { sortOrder: "asc" } } },
  });
  return NextResponse.json(template);
}
