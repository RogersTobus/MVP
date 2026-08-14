import { NextResponse } from "next/server";
import { db, ensurePersonaTable } from "@/lib/db";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  await ensurePersonaTable();
  const { id } = await context.params;
  await db.$executeRawUnsafe(`DELETE FROM "Persona" WHERE "id" = ?`, Number(id));
  return NextResponse.json({ ok: true });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  await ensurePersonaTable();
  const { id } = await context.params;
  const body = await request.json();
  const name = String(body.name || "").trim().slice(0, 50);
  const instruction = String(body.instruction || "").trim().slice(0, 5000);
  if (!name || !instruction) return NextResponse.json({ error: "페르소나 이름과 지침을 모두 입력해 주세요." }, { status: 400 });
  try {
    await db.$executeRawUnsafe(`UPDATE "Persona" SET "name" = ?, "instruction" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`, name, instruction, Number(id));
    const personas = await db.$queryRawUnsafe<Array<{ id: number; name: string; instruction: string }>>(`SELECT "id", "name", "instruction" FROM "Persona" WHERE "id" = ? LIMIT 1`, Number(id));
    if (!personas[0]) return NextResponse.json({ error: "페르소나를 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json(personas[0]);
  } catch {
    return NextResponse.json({ error: "같은 이름의 페르소나가 이미 있습니다." }, { status: 409 });
  }
}
