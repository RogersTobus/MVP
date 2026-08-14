import { chromium, type BrowserContext, type Page } from "playwright-core";
import { CodexCliAdapter } from "@/lib/ai/codex-cli";
import type { PersonaStyleSample } from "@/lib/ai/types";
import { db, ensurePersonaResearchTables, type StoredPersonaResearch } from "@/lib/db";
import { ensureChromeDebugSession } from "@/lib/publishers/chrome-debug";

type Candidate = { blogId: string; logNo: string; title: string; url: string };
type ResearchSource = { id: number; researchId: number; blogId: string; title: string; url: string; createdAt: string };

const globalJobs = globalThis as unknown as { personaResearchJobs?: Set<number> };
if (!globalJobs.personaResearchJobs) globalJobs.personaResearchJobs = new Set<number>();

function keywordList(value: string) {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

function unwrapNaverRedirect(href: string) {
  try {
    const url = new URL(href);
    for (const key of ["u", "url", "target", "link"]) {
      const value = url.searchParams.get(key);
      if (value && /^https?:\/\//i.test(value)) return decodeURIComponent(value);
    }
  } catch { /* Use the original link. */ }
  return href;
}

function normalizeBlogLink(rawHref: string, title: string): Candidate | null {
  try {
    const href = unwrapNaverRedirect(rawHref);
    const url = new URL(href);
    if (!url.hostname.endsWith("blog.naver.com")) return null;
    let blogId = url.searchParams.get("blogId") || "";
    let logNo = url.searchParams.get("logNo") || "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (!blogId && parts.length >= 2 && /^\d+$/.test(parts[1])) {
      [blogId, logNo] = parts;
    }
    if (!blogId || !/^\d+$/.test(logNo)) return null;
    return {
      blogId,
      logNo,
      title: title.trim().replace(/\s+/g, " ").slice(0, 160),
      url: `https://m.blog.naver.com/${encodeURIComponent(blogId)}/${logNo}`,
    };
  } catch { return null; }
}

async function assertNoSecurityCheck(page: Page) {
  const bodyText = await page.locator("body").innerText({ timeout: 4_000 }).catch(() => "");
  if (/captcha|자동입력 방지|보안 확인|비정상적인 접근/i.test(bodyText)) {
    throw new Error("네이버 보안 확인이 표시되어 연구를 중단했습니다. 우회하지 않고 열린 Chrome 창에서 사용자가 직접 확인해야 합니다.");
  }
}

async function collectCandidates(context: BrowserContext, keywords: string[], targetCount: number) {
  const page = await context.newPage();
  const candidates = new Map<string, Candidate>();
  try {
    for (const keyword of keywords) {
      for (let pageIndex = 0; pageIndex < 10 && candidates.size < targetCount * 2; pageIndex += 1) {
        const start = pageIndex * 10 + 1;
        const url = `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_pge&query=${encodeURIComponent(keyword)}&start=${start}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(550);
        await assertNoSecurityCheck(page);
        const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({
          href: (anchor as HTMLAnchorElement).href,
          title: (anchor.textContent || "").trim(),
        })));
        for (const link of links) {
          const candidate = normalizeBlogLink(link.href, link.title);
          if (candidate && !candidates.has(candidate.blogId)) candidates.set(candidate.blogId, candidate);
        }
        if (links.length === 0) break;
        await page.waitForTimeout(300);
      }
      if (candidates.size >= targetCount * 2) break;
    }
    return [...candidates.values()];
  } finally {
    await page.close().catch(() => undefined);
  }
}

function cleanArticleText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function readCandidate(page: Page, candidate: Candidate) {
  await page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 22_000 });
  await page.waitForTimeout(450);
  await assertNoSecurityCheck(page);
  const selectors = [".se-main-container", "#postViewArea", ".post_ct"];
  let text = "";
  for (const selector of selectors) {
    text = await page.locator(selector).first().innerText({ timeout: 2_500 }).catch(() => "");
    if (text.length >= 300) break;
  }
  if (text.length < 300) text = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  text = cleanArticleText(text);
  if (text.length < 300) return null;
  const pageTitle = await page.locator(".se-title-text, .pcol1, h3, h2").first().innerText({ timeout: 1_500 }).catch(() => "");
  return { ...candidate, title: cleanArticleText(pageTitle || candidate.title).slice(0, 160), text: text.slice(0, 6_000) };
}

async function updateResearch(id: number, fields: Record<string, string | number | null>) {
  const entries = Object.entries(fields);
  if (!entries.length) return;
  const assignments = entries.map(([key]) => `"${key}" = ?`).join(", ");
  await db.$executeRawUnsafe(`UPDATE "PersonaResearch" SET ${assignments}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`, ...entries.map(([, value]) => value), id);
}

async function storeSource(researchId: number, sample: PersonaStyleSample) {
  await db.$executeRawUnsafe(`INSERT OR IGNORE INTO "PersonaResearchSource" ("researchId", "blogId", "title", "url") VALUES (?, ?, ?, ?)`, researchId, sample.blogId, sample.title, sample.url);
}

export async function getPersonaResearch(id: number) {
  await ensurePersonaResearchTables();
  const rows = await db.$queryRawUnsafe<StoredPersonaResearch[]>(`SELECT * FROM "PersonaResearch" WHERE "id" = ? LIMIT 1`, id);
  const research = rows[0];
  if (!research) return null;
  const sources = await db.$queryRawUnsafe<ResearchSource[]>(`SELECT * FROM "PersonaResearchSource" WHERE "researchId" = ? ORDER BY "id" ASC`, id);
  const persona = research.personaId ? (await db.$queryRawUnsafe<Array<{ id: number; name: string; instruction: string }>>(`SELECT "id", "name", "instruction" FROM "Persona" WHERE "id" = ? LIMIT 1`, research.personaId))[0] : null;
  return { ...research, sources, persona };
}

export async function getLatestPersonaResearch() {
  await ensurePersonaResearchTables();
  const rows = await db.$queryRawUnsafe<StoredPersonaResearch[]>(`SELECT * FROM "PersonaResearch" ORDER BY "id" DESC LIMIT 1`);
  return rows[0] ? getPersonaResearch(rows[0].id) : null;
}

export async function createPersonaResearch(input: { name: string; keywords: string; targetCount?: number }) {
  await ensurePersonaResearchTables();
  const targetCount = Math.max(20, Math.min(100, Math.round(input.targetCount || 100)));
  await db.$executeRawUnsafe(`INSERT INTO "PersonaResearch" ("name", "keywords", "targetCount", "status", "updatedAt") VALUES (?, ?, ?, 'queued', CURRENT_TIMESTAMP)`, input.name, input.keywords, targetCount);
  const rows = await db.$queryRawUnsafe<StoredPersonaResearch[]>(`SELECT * FROM "PersonaResearch" ORDER BY "id" DESC LIMIT 1`);
  const research = rows[0];
  startPersonaResearchJob(research.id);
  return getPersonaResearch(research.id);
}

export function startPersonaResearchJob(id: number) {
  if (globalJobs.personaResearchJobs!.has(id)) return;
  globalJobs.personaResearchJobs!.add(id);
  void runPersonaResearchJob(id).finally(() => globalJobs.personaResearchJobs!.delete(id));
}

async function runPersonaResearchJob(id: number) {
  try {
    await ensurePersonaResearchTables();
    const rows = await db.$queryRawUnsafe<StoredPersonaResearch[]>(`SELECT * FROM "PersonaResearch" WHERE "id" = ? LIMIT 1`, id);
    const research = rows[0];
    if (!research) return;
    const settings = await db.appSetting.findUnique({ where: { id: 1 } });
    if (!settings) throw new Error("앱 설정을 찾지 못했습니다.");
    const keywords = keywordList(research.keywords);
    if (!keywords.length) throw new Error("연구 키워드를 한 개 이상 입력해 주세요.");

    await updateResearch(id, { status: "collecting", sampledCount: 0, error: "" });
    await ensureChromeDebugSession(settings.chromeDebugUrl);
    const browser = await chromium.connectOverCDP(settings.chromeDebugUrl);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Chrome 디버깅 세션을 찾지 못했습니다.");
    const candidates = await collectCandidates(context, keywords, research.targetCount);
    if (!candidates.length) throw new Error("검색 결과에서 분석할 네이버 블로그 글을 찾지 못했습니다.");

    const page = await context.newPage();
    const samples: PersonaStyleSample[] = [];
    try {
      for (const candidate of candidates) {
        if (samples.length >= research.targetCount) break;
        try {
          const article = await readCandidate(page, candidate);
          if (!article) continue;
          const sample = { blogId: article.blogId, title: article.title, url: article.url, text: article.text };
          samples.push(sample);
          await storeSource(id, sample);
          await updateResearch(id, { sampledCount: samples.length });
          await page.waitForTimeout(250);
        } catch (error) {
          if (/보안 확인|자동입력 방지|비정상적인 접근/i.test((error as Error).message)) throw error;
        }
      }
    } finally {
      await page.close().catch(() => undefined);
    }
    if (samples.length < Math.min(20, research.targetCount)) throw new Error(`유효한 글을 ${samples.length}개만 확인했습니다. 키워드를 넓혀 다시 시도해 주세요.`);

    await updateResearch(id, { status: "analyzing", sampledCount: samples.length });
    const analyzer = new CodexCliAdapter(settings.cliCommand, settings.cliExtraArgs);
    const result = await analyzer.analyzePersona({ name: research.name, keywords: research.keywords, samples });
    await db.$executeRawUnsafe(`INSERT INTO "Persona" ("name", "instruction", "updatedAt") VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT("name") DO UPDATE SET "instruction" = excluded."instruction", "updatedAt" = CURRENT_TIMESTAMP`, research.name, result.instruction);
    const personas = await db.$queryRawUnsafe<Array<{ id: number }>>(`SELECT "id" FROM "Persona" WHERE "name" = ? LIMIT 1`, research.name);
    await updateResearch(id, { status: "completed", summary: result.analysisSummary, personaId: personas[0].id, error: "" });
  } catch (error) {
    await updateResearch(id, { status: "failed", error: (error as Error).message.slice(0, 1000) }).catch(() => undefined);
  }
}
