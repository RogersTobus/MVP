import { chromium, type Locator, type Page } from "playwright-core";
import type { BlogPublisher, PublishBlock, PublishDraft, PublishResult } from "./types";
import { ensureChromeDebugSession } from "./chrome-debug";

const EDITOR_SETTLE_MS = 450;

async function editorText(page: Page) {
  return (await page.locator(".se-component").allTextContents()).join("\n");
}

async function waitForText(page: Page, text: string, timeoutMs = 8000) {
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 28);
  if (!snippet) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = (await editorText(page)).replace(/\s+/g, " ");
    if (current.includes(snippet)) {
      await page.waitForTimeout(EDITOR_SETTLE_MS);
      return true;
    }
    await page.waitForTimeout(180);
  }
  return false;
}

async function waitForCountIncrease(page: Page, locator: Locator, before: number, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.count() > before) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function firstVisible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    if (await target.isVisible().catch(() => false)) return target;
  }
  return null;
}

async function lastVisible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const targets = page.locator(selector);
    for (let index = await targets.count() - 1; index >= 0; index -= 1) {
      const target = targets.nth(index);
      if (await target.isVisible().catch(() => false)) return target;
    }
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
  const lastParagraph = await lastVisible(page, [
    ".se-section-text .se-text-paragraph",
    ".se-section-text [contenteditable='true']",
    ".se-component-content [contenteditable='true'][data-placeholder*='내용']",
  ]);
  await (lastParagraph || body).click();
  await page.keyboard.press("End");
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
    if (!await waitForText(page, paragraph)) throw new Error(`본문 문단이 편집기에 반영되지 않아 다음 작업을 중단했습니다: ${paragraph.slice(0, 24)}`);
    hasContent = true;
  }
  return hasContent;
}

async function uploadImage(page: Page, body: Locator, imagePath: string) {
  const imageComponents = page.locator(".se-component-image, .se-section-image");
  const imageCountBefore = await imageComponents.count();
  await moveToEnd(page, body);
  await page.keyboard.press("Enter");
  let button = await firstVisible(page, [
    "button[data-name='image']",
    "button[data-name='photo']",
    ".se-image-toolbar-button",
    ".se-toolbar-item-image button",
    ".se-toolbar-item-photo button",
    "button[class*='image']",
    "button[class*='photo']",
    "button[aria-label*='사진']",
    "button[aria-label*='이미지']",
    "button[title*='사진']",
    "button[title*='이미지']",
  ]);
  if (!button) {
    const namedButton = page.getByRole("button", { name: /사진|이미지/ }).first();
    if (await namedButton.isVisible().catch(() => false)) button = namedButton;
  }
  if (!button) {
    const namedControl = page.getByText(/^(사진|이미지)$/, { exact: true }).first();
    if (await namedControl.isVisible().catch(() => false)) button = namedControl;
  }
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
  const uploaded = await waitForCountIncrease(page, imageComponents, imageCountBefore, 15000);
  if (uploaded) await page.waitForTimeout(EDITOR_SETTLE_MS);
  return uploaded;
}

async function insertNaverSticker(page: Page, body: Locator) {
  const stickerComponents = page.locator(".se-component-sticker, .se-section-sticker");
  const stickerCountBefore = await stickerComponents.count();
  await moveToEnd(page, body);
  await page.keyboard.press("Enter");
  const button = await firstVisible(page, [
    "button[data-name='sticker']",
    ".se-toolbar-item-sticker button",
    "button[aria-label*='스티커']",
    "button[title*='스티커']",
  ]) || (await page.getByRole("button", { name: /스티커/ }).first().isVisible().catch(() => false) ? page.getByRole("button", { name: /스티커/ }).first() : null);
  if (!button) return false;
  await button.click().catch(() => undefined);
  await page.waitForTimeout(500);
  const sticker = await firstVisible(page, [
    ".se-popup-sticker:visible img",
    ".se-popup-sticker:visible [role='button']",
    ".se-popup-sticker:visible button",
    "[class*='sticker_popup']:visible img",
  ]);
  if (!sticker) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return false;
  }
  await sticker.click().catch(() => undefined);
  const inserted = await waitForCountIncrease(page, stickerComponents, stickerCountBefore, 10000);
  if (inserted) await page.waitForTimeout(EDITOR_SETTLE_MS);
  return inserted;
}

async function appendQuotationHeading(page: Page, body: Locator, label: string, hasContent: boolean) {
  const quotationComponents = page.locator(".se-component-quotation, .se-section-quotation");
  const quotationCountBefore = await quotationComponents.count();
  const button = await firstVisible(page, [
    "button[data-name='quotation']",
    ".se-toolbar-item-quotation button",
    "button[aria-label*='인용구']",
    "button[title*='인용구']",
  ]);
  if (!button) return false;
  await moveToEnd(page, body);
  if (hasContent) {
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
  }
  await button.click().catch(() => undefined);
  await page.waitForTimeout(350);
  const style = await firstVisible(page, [
    ".se-popup-quotation:visible [data-value]",
    ".se-popup-quotation:visible button",
    "[class*='quotation_popup']:visible button",
  ]);
  if (style) await style.click().catch(() => undefined);
  const componentCreated = await waitForCountIncrease(page, quotationComponents, quotationCountBefore, 8000);
  if (!componentCreated) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return false;
  }
  const target = await lastVisible(page, [
    ".se-section-quotation [contenteditable='true']",
  ]);
  if (!target) return false;
  await target.click();
  await page.keyboard.insertText(label);
  const labelInserted = await waitForText(page, label, 5000);
  return labelInserted;
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
    const editorPopup = page.locator(".se-popup-alert-confirm:visible, [data-name*='popup-alert-confirm']:visible").first();
    if (await editorPopup.isVisible().catch(() => false)) {
      const popupText = (await editorPopup.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 120);
      return { status: "manual_required", message: `네이버 편집기에 확인 팝업이 열려 있습니다${popupText ? `: ${popupText}` : "."} 팝업을 직접 처리한 뒤 다시 시도해 주세요.`, url: page.url() };
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
    let stickerInserted = false;
    const medical = /병원|진료|의료/.test(draft.categoryName);

    for (const imagePath of draft.coverImagePaths) {
      if (await uploadImage(page, body, imagePath)) uploadedImages += 1;
      else missedImages += 1;
      hasContent = true;
      await page.waitForTimeout(EDITOR_SETTLE_MS);
    }
    for (let blockIndex = 0; blockIndex < draft.blocks.length; blockIndex += 1) {
      const block = draft.blocks[blockIndex];
      if (block.type !== "image") {
        const showHeading = headingTypes.has(block.type) && !internalLabels.has(block.label.trim());
        const quotationInserted = showHeading ? await appendQuotationHeading(page, body, block.label.trim(), hasContent) : false;
        if (quotationInserted) {
          hasContent = await appendText(page, body, block.text.trim(), true);
        } else {
          hasContent = await appendText(page, body, formattedBlockText(block, headingIndex, medical), hasContent);
        }
        if (showHeading) headingIndex += 1;
        if (!stickerInserted && block.text.trim()) stickerInserted = await insertNaverSticker(page, body);
        const verificationParagraphs = readableParagraphs(block.text);
        const verificationText = verificationParagraphs[verificationParagraphs.length - 1] || block.label;
        if (!await waitForText(page, verificationText)) {
          return { status: "manual_required", message: `${blockIndex + 1}번째 블록 '${block.label}'이 편집기에 완전히 반영되지 않아 다음 블록 입력을 중단했습니다. 열린 화면을 확인한 뒤 다시 시도해 주세요.`, url: page.url() };
        }
      }
      for (const imagePath of block.imagePaths) {
        if (await uploadImage(page, body, imagePath)) uploadedImages += 1;
        else missedImages += 1;
        hasContent = true;
        await page.waitForTimeout(EDITOR_SETTLE_MS);
      }
      await page.waitForTimeout(EDITOR_SETTLE_MS);
    }

    if (draft.hashtags.length > 0) {
      hasContent = await appendText(page, body, draft.hashtags.map((tag) => `#${tag.replace(/^#+/, "")}`).join(" "), hasContent);
    }

    const textBlocks = draft.blocks.filter((block) => block.type !== "image" && block.text.trim());
    let orderVerified = textBlocks.length <= 1;
    if (textBlocks.length > 1) {
      const firstSnippet = readableParagraphs(formattedBlockText(textBlocks[0], 0, medical))[0]?.slice(0, 32);
      const lastBlock = textBlocks[textBlocks.length - 1];
      const lastParagraphs = readableParagraphs(formattedBlockText(lastBlock, headingIndex, medical));
      const lastSnippet = lastParagraphs[lastParagraphs.length - 1]?.slice(0, 32);
      const editorText = await page.locator(".se-section-text").innerText().catch(() => "");
      const firstPosition = firstSnippet ? editorText.indexOf(firstSnippet) : -1;
      const lastPosition = lastSnippet ? editorText.indexOf(lastSnippet) : -1;
      orderVerified = firstPosition >= 0 && lastPosition >= 0 && firstPosition < lastPosition;
      if (firstPosition >= 0 && lastPosition >= 0 && firstPosition > lastPosition) {
        return { status: "manual_required", message: "네이버 편집기에 본문 순서가 반대로 입력된 것을 감지해 게시 준비를 중단했습니다. 열린 초안은 사용하지 말고 다시 시도해 주세요.", url: page.url() };
      }
    }
    if (!orderVerified) {
      return { status: "manual_required", message: "본문은 입력했지만 첫 문단과 마지막 문단의 순서를 자동 확인하지 못했습니다. 열린 작성 화면의 순서를 확인해 주세요.", url: page.url() };
    }
    if (missedImages > 0) {
      return { status: "manual_required", message: `본문 순서는 정상입니다. 다만 이미지 ${missedImages}장은 네이버 편집기에 자동 첨부하지 못했습니다. 열린 화면에서 사진을 직접 확인해 주세요.`, url: page.url() };
    }
    const imageMessage = uploadedImages ? ` 이미지 ${uploadedImages}장도 본문 순서에 맞춰 넣었습니다.` : " 생성된 이미지가 없어 본문만 입력했습니다.";
    const effectMessage = ` 해시태그 ${draft.hashtags.length}개를 붙였고, 스티커는 ${stickerInserted ? "도입 뒤에 넣었습니다" : "편집기에서 자동 선택하지 못해 미리보기 위치만 참고해 주세요"}.`;
    return { status: "ready", message: `가독성을 다듬은 본문을 작성 화면에 채웠습니다.${imageMessage}${effectMessage} 내용을 확인한 뒤 게시 버튼은 직접 눌러 주세요.`, url: page.url() };
  }
}
