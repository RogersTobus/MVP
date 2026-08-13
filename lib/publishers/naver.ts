import { chromium, type Locator, type Page } from "playwright-core";
import type { BlogPublisher, PublishBlock, PublishDraft, PublishResult } from "./types";
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
  await target.press("Backspace").catch(() => undefined);
  await target.pressSequentially(text, { delay: 1 });
}

const internalLabels = new Set(["도입", "공감", "문제 제기", "핵심 정보", "사례", "제품 소개", "결론", "CTA", "자유 블록", "이미지"]);
const headingTypes = new Set(["problem", "core", "case", "product", "faq"]);

function formattedBlockText(block: PublishBlock, headingIndex: number, medical: boolean) {
  const text = block.text.trim().replace(/^소제목\s*\d*\s*[.:：]\s*/gm, "");
  if (!text) return "";
  const showHeading = headingTypes.has(block.type) && !internalLabels.has(block.label.trim());
  if (!showHeading) return text;
  const marks = medical ? ["🔎", "✔"] : ["✦", "💡", "✓"];
  const mark = headingIndex < 3 ? `${marks[headingIndex % marks.length]} ` : "";
  return `${mark}${block.label.trim()}\n\n${text}`;
}

async function moveToEnd(page: Page, body: Locator) {
  await body.click();
  await page.keyboard.press("Control+End");
}

function readableParagraphs(text: string) {
  const explicitParagraphs = text.replace(/\r/g, "").split(/\n{2,}/).map((item) => item.replace(/\n+/g, " ").trim()).filter(Boolean);
  return explicitParagraphs.flatMap((paragraph) => {
    if (paragraph.length <= 115 || /^(?:[✦💡✓🔎✔]|Q\.?\s*\d*|[-•■□])\s*/.test(paragraph)) return [paragraph];
    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
    if (sentences.length < 2) return [paragraph];
    const groups: string[] = [];
    let current = "";
    for (const sentence of sentences) {
      if (current && (current.length + sentence.length > 115 || current.split(/[.!?。！？]/).filter(Boolean).length >= 2)) {
        groups.push(current);
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }
    if (current) groups.push(current);
    return groups;
  });
}

async function appendText(page: Page, body: Locator, text: string, hasContent: boolean) {
  if (!text.trim()) return hasContent;
  for (const paragraph of readableParagraphs(text)) {
    await moveToEnd(page, body);
    if (hasContent) {
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
    }
    await page.keyboard.insertText(paragraph);
    hasContent = true;
  }
  return hasContent;
}

async function uploadImage(page: Page, body: Locator, imagePath: string) {
  await moveToEnd(page, body);
  await page.keyboard.press("Enter");
  const button = await firstVisible(page, [
    "button[data-name='image']",
    ".se-image-toolbar-button",
    ".se-toolbar-item-image button",
    "button[aria-label*='사진']",
    "button[title*='사진']",
  ]);
  if (!button) return false;

  const chooserPromise = page.waitForEvent("filechooser", { timeout: 1200 }).catch(() => null);
  await button.click();
  const chooser = await chooserPromise;
  if (chooser) {
    await chooser.setFiles(imagePath);
  } else {
    const fileInput = page.locator("input[type='file'][accept*='image']").last();
    if (await fileInput.count() === 0) return false;
    await fileInput.setInputFiles(imagePath);
  }
  await page.waitForTimeout(1600);
  return true;
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
    await body.click();
    await body.press("Control+A").catch(() => undefined);
    await body.press("Backspace").catch(() => undefined);

    let hasContent = false;
    let uploadedImages = 0;
    let missedImages = 0;
    let headingIndex = 0;
    const medical = /병원|진료|의료/.test(draft.categoryName);

    for (const imagePath of draft.coverImagePaths) {
      if (await uploadImage(page, body, imagePath)) uploadedImages += 1;
      else missedImages += 1;
      hasContent = true;
    }
    for (const block of draft.blocks) {
      if (block.type !== "image") {
        const showHeading = headingTypes.has(block.type) && !internalLabels.has(block.label.trim());
        hasContent = await appendText(page, body, formattedBlockText(block, headingIndex, medical), hasContent);
        if (showHeading) headingIndex += 1;
      }
      for (const imagePath of block.imagePaths) {
        if (await uploadImage(page, body, imagePath)) uploadedImages += 1;
        else missedImages += 1;
        hasContent = true;
      }
    }

    if (missedImages > 0) {
      return { status: "manual_required", message: `본문은 입력했지만 이미지 ${missedImages}장은 네이버 편집기에 자동 첨부하지 못했습니다. 열린 화면에서 사진을 직접 확인해 주세요.`, url: page.url() };
    }
    const imageMessage = uploadedImages ? ` 이미지 ${uploadedImages}장도 본문 순서에 맞춰 넣었습니다.` : " 생성된 이미지가 없어 본문만 입력했습니다.";
    return { status: "ready", message: `가독성을 다듬은 본문을 작성 화면에 채웠습니다.${imageMessage} 내용을 확인한 뒤 게시 버튼은 직접 눌러 주세요.`, url: page.url() };
  }
}
