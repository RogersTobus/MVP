import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function collectNaverImageReferences(input: { topic: string; debugUrl: string; limit: number }) {
  if (input.limit <= 0) return [];
  const browser = await chromium.connectOverCDP(input.debugUrl);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Chrome 디버깅 세션을 찾지 못했습니다.");
  const page = await context.newPage();
  const saved: string[] = [];
  try {
    const url = `https://search.naver.com/search.naver?where=image&sm=tab_jum&query=${encodeURIComponent(input.topic)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1800);
    for (let index = 0; index < 3; index += 1) {
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(450);
    }
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/captcha|자동입력 방지|보안 확인/i.test(bodyText)) throw new Error("검색 중 보안 확인이 표시되어 자동 수집을 중단했습니다.");

    const candidates = await page.locator("img").evaluateAll((images) => images.map((node) => {
      const image = node as HTMLImageElement;
      return { url: image.currentSrc || image.src || image.getAttribute("data-lazy-src") || image.getAttribute("data-src") || "", width: image.naturalWidth, height: image.naturalHeight };
    }).filter((item) => /^https?:\/\//.test(item.url) && item.width >= 120 && item.height >= 120));

    const outputDir = path.join(process.cwd(), "public", "references");
    await mkdir(outputDir, { recursive: true });
    for (const candidate of [...new Map(candidates.map((item) => [item.url, item])).values()]) {
      if (saved.length >= input.limit) break;
      try {
        const response = await context.request.get(candidate.url, { headers: { Referer: page.url() }, timeout: 15_000 });
        const type = (response.headers()["content-type"] || "").split(";")[0].toLowerCase();
        const extension = extensions[type];
        if (!response.ok() || !extension) continue;
        const buffer = await response.body();
        if (buffer.length < 5_000 || buffer.length > 10 * 1024 * 1024) continue;
        const filename = `web-${randomUUID()}.${extension}`;
        await writeFile(path.join(outputDir, filename), buffer);
        saved.push(`/references/${filename}`);
      } catch { /* Try the next ranked result. */ }
    }
    return saved;
  } finally {
    await page.close().catch(() => undefined);
  }
}
