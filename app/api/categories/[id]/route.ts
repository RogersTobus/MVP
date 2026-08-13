import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json();
  const category = await db.category.update({ where: { id: Number(id) }, data: { name: body.name?.trim(), memory: body.memory ?? "", imageMemory: body.imageMemory ?? "", color: body.color || "sage" } });
  return NextResponse.json(category);
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (await db.content.count({ where: { categoryId: Number(id) } })) {
    return NextResponse.json({ error: "이 카테고리에 저장된 콘텐츠가 있어 삭제할 수 없습니다." }, { status: 409 });
  }
  await db.category.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
