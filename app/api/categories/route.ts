import { NextResponse } from "next/server";
import { db, ensureSeed } from "@/lib/db";

export async function POST(request: Request) {
  await ensureSeed();
  const body = await request.json();
  if (!body.name?.trim()) return NextResponse.json({ error: "카테고리명을 입력해 주세요." }, { status: 400 });
  try {
    const category = await db.category.create({ data: { name: body.name.trim(), memory: body.memory?.trim() || "", imageMemory: body.imageMemory?.trim() || "", color: body.color || "sage" } });
    return NextResponse.json(category);
  } catch {
    return NextResponse.json({ error: "같은 이름의 카테고리가 이미 있습니다." }, { status: 409 });
  }
}
