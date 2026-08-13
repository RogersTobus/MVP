import { chromium, type Locator, type Page } from "playwright-core";
import type { BlogPublisher, PublishDraft, PublishResult } from "./types";
import { ensureChromeDebugSession } from "./chrome-debug";

async function firstVisible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    if (await target.isVisible().catch(() => false)) return target;
  }
  return null;
}

async function insertEditable(target: Locator, text: string) {
  await target.click();
  await target.press("Control+A").catch(() => undefined);
  await target.pressSequentially(text, { delay: 1 });
}

export class NaverPublisher implements BlogPublisher {
  constructor(private blogId: string, private debugUrl: string) {}

  async prepareDraft(draft: PublishDraft): Promise<PublishResult> {
    if (!this.blogId) throw new Error("설정에서 네이버 블로그 ID를 입력해 주세요.");
    await ensureChromeDebugSession(this.debugUrl);
    let browser;
    try {
      browser = await chromium.connectOverCDP(this.debugUrl);
    } catch {
      throw new Error("콘텐츠 스튜디오용 Chrome에 연결하지 못했습니다. 열린 Chrome 창을 확인한 뒤 다시 시도해 주세요.");
    }
    const context = browser.contexts()[0];
    if (!context) throw new Error("Chrome 디버깅 세션을 찾지 못했습니다.");
    const page = await context.newPage();
    await page.goto(`https://blog.naver.com/${encodeURIComponent(this.blogId)}/postwrite`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    if (/nid\.naver\.com/.test(page.url())) {
      return { status: "manual_required", message: "Chrome에서 네이버에 정상 로그인한 뒤 다시 시도해 주세요.", url: page.url() };
    }
    const visibleText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    if (visibleText.includes("captcha") || visibleText.includes("자동입력 방지")) {
      return { status: "manual_required", message: "보안 확인 화면이 표시되었습니다. 자동화를 중단했으니 사용자가 직접 확인해 주세요.", url: page.url() };
    }

    const title = await firstVisible(page, [
      ".se-section-documentTitle .se-text-paragraph",
      ".se-documentTitle .se-text-paragraph",
      "[contenteditable='true'][data-placeholder*='제목']",
    ]);
    const body = await firstVisible(page, [
      ".se-section-text .se-text-paragraph",
      ".se-component-content [contenteditable='true']",
      "[contenteditable='true'][data-placeholder*='내용']",
    ]);

    if (!title || !body) {
      return { status: "manual_required", message: "네이버 편집기 구조를 자동으로 확인하지 못했습니다. 열린 작성 화면에서 직접 붙여넣어 주세요.", url: page.url() };
    }
    await insertEditable(title, draft.title);
    await insertEditable(body, draft.body);
    return { status: "ready", message: "작성 화면에 초안을 채웠습니다. 내용을 확인한 뒤 게시 버튼은 직접 눌러 주세요.", url: page.url() };
  }
}
