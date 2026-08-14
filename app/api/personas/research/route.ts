import { NextResponse } from "next/server";
import { createPersonaResearch, getLatestPersonaResearch, startPersonaResearchJob } from "@/lib/persona-research";

export async function GET() {
  const research = await getLatestPersonaResearch();
  if (research && ["queued", "collecting", "analyzing"].includes(research.status)) startPersonaResearchJob(research.id);
  return NextResponse.json(research);
}

export async function POST(request: Request) {
  const body = await request.json();
  const name = String(body.name || "").trim().slice(0, 50);
  const keywords = String(body.keywords || "").trim().slice(0, 500);
  if (!name || !keywords) return NextResponse.json({ error: "페르소나 이름과 연구 키워드를 모두 입력해 주세요." }, { status: 400 });
  const research = await createPersonaResearch({ name, keywords, targetCount: Number(body.targetCount) || 100 });
  return NextResponse.json(research, { status: 202 });
}
