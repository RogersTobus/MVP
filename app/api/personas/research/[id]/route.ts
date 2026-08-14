import { NextResponse } from "next/server";
import { getPersonaResearch, startPersonaResearchJob } from "@/lib/persona-research";
import { db } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const research = await getPersonaResearch(Number(id));
  if (!research) return NextResponse.json({ error: "연구 작업을 찾지 못했습니다." }, { status: 404 });
  if (["queued", "collecting", "analyzing"].includes(research.status)) startPersonaResearchJob(research.id);
  return NextResponse.json(research);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const research = await getPersonaResearch(Number(id));
  if (!research) return NextResponse.json({ error: "연구 작업을 찾지 못했습니다." }, { status: 404 });
  if (["queued", "collecting", "analyzing"].includes(research.status)) return NextResponse.json({ error: "진행 중인 연구는 삭제할 수 없습니다." }, { status: 409 });
  await db.$executeRawUnsafe(`DELETE FROM "PersonaResearch" WHERE "id" = ?`, Number(id));
  return NextResponse.json({ ok: true });
}
