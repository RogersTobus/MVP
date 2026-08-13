import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json();
  const template = await db.template.update({
    where: { id: Number(id) },
    data: {
      name: body.name.trim(),
      description: body.description?.trim() || "",
      blocks: {
        deleteMany: {},
        create: body.blocks.map((block: { type: string; label: string; instruction?: string }, index: number) => ({ type: block.type, label: block.label, instruction: block.instruction || "", sortOrder: index })),
      },
    },
    include: { blocks: { orderBy: { sortOrder: "asc" } } },
  });
  return NextResponse.json(template);
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await db.template.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
