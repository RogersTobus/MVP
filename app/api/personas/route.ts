import { NextResponse } from "next/server";
import { db, ensurePersonaTable } from "@/lib/db";

export async function POST(request: Request) {
  await ensurePersonaTable();
  const body = await request.json();
  const name = String(body.name || "").trim().slice(0, 50);
  const instruction = String(body.instruction || "").trim().slice(0, 5000);
  if (!name || !instruction) return NextResponse.json({ error: "페르소나 이름과 지침을 모두 입력해 주세요." }, { status: 400 });
  try {
    await db.$executeRawUnsafe(`INSERT INTO "Persona" ("name", "instruction", "updatedAt") VALUES (?, ?, CURRENT_TIMESTAMP)`, name, instruction);
    const personas = await db.$queryRawUnsafe<Array<{ id: number; name: string; instruction: string }>>(`SELECT * FROM "Persona" WHERE "name" = ? LIMIT 1`, name);
    return NextResponse.json(personas[0]);
  } catch {
    return NextResponse.json({ error: "같은 이름의 페르소나가 이미 있습니다." }, { status: 409 });
  }
}
