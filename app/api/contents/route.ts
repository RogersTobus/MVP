import { NextResponse } from "next/server";
import { completeTopicHashtags, contentInclude, db } from "@/lib/db";

export async function POST(request: Request) {
  const body = await request.json();
  const content = await db.content.create({
    data: {
      categoryId: Number(body.categoryId),
      topic: body.topic?.trim() || "새 글",
      title: body.title?.trim() || "제목 없음",
      summary: body.summary ?? "",
      body: body.body ?? "",
      extraInstructions: body.extraInstructions ?? "",
      hashtags: JSON.stringify(completeTopicHashtags(body.hashtags, body.topic?.trim() || "새 글", body.title?.trim() || "")),
      blocks: { create: (body.blocks || []).map((block: { type: string; label: string; instruction?: string; text?: string }, index: number) => ({ ...block, instruction: block.instruction || "", text: block.text || "", sortOrder: index })) },
    },
    include: contentInclude,
  });
  return NextResponse.json({ ...content, hashtags: completeTopicHashtags(body.hashtags, content.topic, content.title) });
}
