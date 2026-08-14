import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const runtime = "nodejs";

const allowedTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("images").filter((value): value is File => value instanceof File).slice(0, 8);
  if (!files.length) return NextResponse.json({ error: "붙여넣거나 선택한 이미지가 없습니다." }, { status: 400 });

  const outputDir = path.join(process.cwd(), "public", "references");
  await mkdir(outputDir, { recursive: true });
  const images: Array<{ url: string; name: string }> = [];

  for (const file of files) {
    const extension = allowedTypes[file.type];
    if (!extension) return NextResponse.json({ error: "JPG, PNG, WebP, GIF 이미지만 사용할 수 있습니다." }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "이미지는 장당 10MB 이하여야 합니다." }, { status: 400 });
    const filename = `${Date.now()}-${randomUUID()}.${extension}`;
    await writeFile(path.join(outputDir, filename), Buffer.from(await file.arrayBuffer()));
    images.push({ url: `/references/${filename}`, name: file.name || "붙여넣은 이미지" });
  }

  return NextResponse.json({ images });
}
