import { NextResponse } from "next/server";
import { db, ensurePersonaTable } from "@/lib/db";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  await ensurePersonaTable();
  const { id } = await context.params;
  await db.$executeRawUnsafe(`DELETE FROM "Persona" WHERE "id" = ?`, Number(id));
  return NextResponse.json({ ok: true });
}
