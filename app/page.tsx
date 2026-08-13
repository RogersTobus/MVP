"use client";

import { useEffect, useMemo, useState } from "react";

type Category = { id: number; name: string; memory: string; imageMemory: string; color: string };
type Block = { id?: number; type: string; label: string; instruction: string; text?: string; sortOrder?: number };
type Template = { id: number; name: string; description: string; blocks: Block[] };
type ContentImage = { id: number; contentId: number; prompt: string; url: string; style: string; placementOrder: number; createdAt: string };
type ImageReferenceSource = { url: string; kind: "manual" | "web"; sourcePageUrl?: string; originalImageUrl?: string; title?: string };
type Content = {
  id: number; categoryId: number; topic: string; title: string; summary: string; body: string; extraInstructions: string; imageInstructions: string; imageReferences: string[];
  imageReferenceSources: ImageReferenceSource[]; status: string; publishNote: string; createdAt: string; updatedAt: string; category: Category; blocks: Block[]; images?: ContentImage[];
};
type Settings = { globalMemory: string; globalImageMemory: string; cliCommand: string; cliExtraArgs: string; naverBlogId: string; chromeDebugUrl: string; autoWebReferences: boolean };
type Data = { settings: Settings; categories: Category[]; templates: Template[]; contents: Content[] };
type Tab = "library" | "create" | "memory" | "templates" | "settings";

const blockPalette = [
  ["intro", "도입"], ["empathy", "공감"], ["problem", "문제 제기"], ["core", "핵심 정보"], ["case", "사례"],
  ["product", "제품 소개"], ["faq", "FAQ"], ["conclusion", "결론"], ["cta", "CTA"], ["free", "자유 블록"],
  ["image", "이미지"],
];

const nav: Array<[Tab, string, string]> = [
  ["library", "▦", "콘텐츠 보관함"], ["create", "＋", "새 콘텐츠"], ["memory", "◎", "메모리"],
  ["templates", "◫", "구조 템플릿"], ["settings", "⚙", "연결 설정"],
];

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "요청을 처리하지 못했습니다.");
  return body;
}

async function generateImagesOneByOne(input: { contentId: number; count: number; style: string; imageInstructions?: string }, onProgress: (current: number, total: number) => void) {
  let images: ContentImage[] = [];
  let imageReferences: string[] = [];
  let imageReferenceSources: ImageReferenceSource[] = [];
  for (let index = 0; index < input.count; index += 1) {
    onProgress(index + 1, input.count);
    const result = await api<{ images: ContentImage[]; imageReferences: string[]; imageReferenceSources: ImageReferenceSource[] }>("/api/images", { method: "POST", body: JSON.stringify({ ...input, count: 1, batchIndex: index, batchTotal: input.count }) });
    images = result.images;
    imageReferences = result.imageReferences;
    imageReferenceSources = result.imageReferenceSources;
  }
  return { images, imageReferences, imageReferenceSources };
}

function sourceHost(value?: string) {
  if (!value) return "출처 미기록";
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return "원본 출처"; }
}

function BlogText({ text }: { text: string }) {
  return <>{text.split(/\n{2,}/).map((paragraph, index) => {
    const trimmed = paragraph.trim();
    if (!trimmed) return null;
    const generatedHeading = trimmed.length <= 120 ? trimmed.match(/^소제목\s*\d*\s*[.:：]\s*([^\n]+)$/) : null;
    if (generatedHeading) return <h2 className="inline-generated-heading" key={`${trimmed.slice(0, 24)}-${index}`}>{generatedHeading[1].trim()}</h2>;
    const emojiOnly = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s✨⭐♡♥️·]+$/u.test(trimmed);
    return <p className={emojiOnly ? "emoji-break" : ""} key={`${trimmed.slice(0, 24)}-${index}`}>{trimmed}</p>;
  })}</>;
}

function BlogImage({ image, alt }: { image: ContentImage; alt: string }) {
  return <figure className="naver-image"><img src={image.url} alt={alt} /></figure>;
}

function getPublishingPlan(content: Content) {
  const textBlocks = content.blocks.filter((block) => block.type !== "image" && block.text?.trim());
  const paragraphCount = textBlocks.reduce((total, block) => total + (block.text?.split(/\n{2,}/).filter((item) => item.trim()).length || 0), 0);
  const fullText = textBlocks.map((block) => block.text).join("\n");
  const internalLabels = new Set(["도입", "공감", "문제 제기", "핵심 정보", "사례", "제품 소개", "결론", "CTA", "자유 블록"]);
  const headings = textBlocks
    .filter((block) => ["problem", "core", "case", "product", "faq"].includes(block.type) && !internalLabels.has(block.label.trim()))
    .map((block) => block.label);
  const medical = /병원|진료|의료/.test(content.category.name);
  const subject = `${content.category.name} ${content.topic} ${content.title}`;
  const portfolio = /리모델링|인테리어|시공|포트폴리오|비포\s*애프터|before\s*after/i.test(subject);
  const insight = /마케팅|경영|MBA|AI|자동화|스터디/i.test(subject);
  const imageCount = content.images?.length || 0;
  return {
    paragraphCount,
    headings,
    imageCount,
    hasChecklist: /(^|\n)\s*(?:■|□|✓|✔|[-•])\s+/m.test(fullText),
    hasFaq: /(^|\n)\s*(?:Q\.?\s*\d*|자주 묻는 질문)/im.test(fullText),
    layout: medical ? "정보 설명형" : portfolio ? "포토 포트폴리오형" : insight ? "인사이트형" : "생활 스토리형",
    imageGuide: portfolio ? "공간·단계별 전후 흐름으로 배치" : "설정한 블록 위치에 본문과 함께 배치",
    stickerGuide: medical ? "의료 정보형이라 사용하지 않음" : portfolio ? "공간 전환 사이 1~2회 선택" : "첫 이미지 뒤 1회만 추천",
  };
}

function PublishingBlueprint({ content }: { content: Content }) {
  const plan = getPublishingPlan(content);
  return <section className="publishing-blueprint">
    <div className="blueprint-head"><div><span>발행 설계</span><h3>네이버 게시 연출 지도</h3></div><em>{plan.layout}</em></div>
    <p className="blueprint-help">본문 미리보기는 실제 게시 순서로 붙여 보여줍니다. 점선 항목은 네이버 편집기에서 더할 최종 연출 추천입니다.</p>
    <ol>
      <li><i>1</i><div><b>제목과 첫 장면</b><span>검색어를 담은 제목 뒤, 독자의 구체적인 상황으로 시작</span></div></li>
      <li><i>2</i><div><b>짧은 문단 {plan.paragraphCount}개</b><span>모바일에서 한 덩어리로 보이지 않게 호흡을 분리</span></div></li>
      <li><i>3</i><div><b>이미지 {plan.imageCount}장</b><span>{plan.imageCount ? plan.imageGuide : "아직 생성된 이미지가 없습니다"}</span></div></li>
      {plan.headings.length > 0 && <li><i>4</i><div><b>자연스러운 소제목 {plan.headings.length}개</b><span>{plan.headings.slice(0, 3).join(" · ")}</span></div></li>}
      <li className="recommendation"><i>+</i><div><b>네이버 스티커</b><span>{plan.stickerGuide}</span></div></li>
    </ol>
    <div className="blueprint-signals"><span className={plan.hasChecklist ? "ready" : ""}>체크리스트 {plan.hasChecklist ? "반영" : "선택"}</span><span className={plan.hasFaq ? "ready" : ""}>FAQ {plan.hasFaq ? "반영" : "선택"}</span><span>과장 없는 결론</span></div>
  </section>;
}

function NaverStylePreview({ content }: { content: Content }) {
  const coverImages = (content.images || []).filter((image) => image.placementOrder < 0);
  const headingTypes = new Set(["problem", "core", "case", "product", "faq"]);
  const internalLabels = new Set(["도입", "공감", "문제 제기", "핵심 정보", "사례", "제품 소개", "결론", "CTA", "자유 블록"]);
  return <article className="naver-post-preview">
    <div className="naver-post-head"><span>{content.category.name}</span><h1>{content.title}</h1><div><b>콘텐츠 스튜디오</b><em>{dateText(content.updatedAt)}</em></div></div>
    {coverImages.map((image) => <BlogImage key={image.id} image={image} alt={`${content.title} 대표 이미지`} />)}
    <div className="naver-post-body">{content.blocks.map((block, index) => {
      if (block.type === "image") {
        const images = (content.images || []).filter((image) => image.placementOrder === (block.sortOrder ?? index));
        return images.length ? <div className="naver-image-group" key={block.id || index}>{images.map((image) => <BlogImage key={image.id} image={image} alt={`${block.label} 이미지`} />)}</div> : null;
      }
      const showHeading = headingTypes.has(block.type) && !internalLabels.has(block.label.trim());
      return <section key={block.id || index}>{showHeading && <h2>{block.label}</h2>}<BlogText text={block.text || ""} /></section>;
    })}</div>
  </article>;
}

function dateText(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function Home() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("library");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState(0);
  const [preview, setPreview] = useState<Content | null>(null);

  const refresh = async () => setData(await api<Data>("/api/bootstrap"));
  useEffect(() => { refresh().catch((error) => setNotice(error.message)); }, []);

  const filtered = useMemo(() => data?.contents.filter((content) => {
    const keyword = search.trim().toLowerCase();
    return (!filterCategory || content.categoryId === filterCategory) && (!keyword || `${content.topic} ${content.title} ${content.summary}`.toLowerCase().includes(keyword));
  }) || [], [data, search, filterCategory]);

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3500); };

  if (!data) return <main className="loading"><div className="brand-mark">C</div><p>콘텐츠를 불러오고 있어요</p></main>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">C</div><div><b>콘텐츠 스튜디오</b><span>블로그 업무 도구</span></div></div>
        <nav>{nav.map(([key, icon, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><i>{icon}</i>{label}</button>)}</nav>
        <div className="sidebar-note"><span className="status-dot" /><div><b>로컬 전용</b><small>데이터는 이 PC에 저장됩니다</small></div></div>
      </aside>

      <main className="workspace">
        <header className="topbar"><div><span className="eyebrow">내 콘텐츠</span><h1>{nav.find(([key]) => key === tab)?.[2]}</h1></div><button className="primary compact" onClick={() => setTab("create")}>새 글 만들기</button></header>
        {tab === "library" && <Library data={data} contents={filtered} search={search} setSearch={setSearch} filterCategory={filterCategory} setFilterCategory={setFilterCategory} onPreview={setPreview} onRefresh={refresh} flash={flash} setBusy={setBusy} />}
        {tab === "create" && <CreatePanel data={data} onManageMemory={() => setTab("memory")} onCreated={async (content) => { await refresh(); setPreview(content); setTab("library"); }} busy={busy} setBusy={setBusy} flash={flash} />}
        {tab === "memory" && <MemoryPanel data={data} onRefresh={refresh} flash={flash} />}
        {tab === "templates" && <TemplatesPanel data={data} onRefresh={refresh} flash={flash} />}
        {tab === "settings" && <SettingsPanel data={data} onRefresh={refresh} flash={flash} />}
      </main>
      {preview && <PreviewModal content={preview} data={data} onClose={() => setPreview(null)} onSaved={async (content) => { setPreview(content); await refresh(); }} flash={flash} />}
      {notice && <div className="toast">{notice}</div>}
      {busy && <div className="busy"><div className="spinner" /><b>{busy}</b><span>창을 닫지 말고 잠시 기다려 주세요.</span></div>}
    </div>
  );
}

function Library({ data, contents, search, setSearch, filterCategory, setFilterCategory, onPreview, onRefresh, flash, setBusy }: {
  data: Data; contents: Content[]; search: string; setSearch: (v: string) => void; filterCategory: number; setFilterCategory: (v: number) => void;
  onPreview: (v: Content) => void; onRefresh: () => Promise<void>; flash: (v: string) => void; setBusy: (v: string) => void;
}) {
  const preparePublish = async (content: Content) => {
    setBusy("전용 Chrome을 확인하고 네이버 작성 화면을 준비하고 있습니다");
    try {
      const result = await api<{ message: string }>("/api/publish", { method: "POST", body: JSON.stringify({ contentId: content.id }) });
      flash(result.message); await onRefresh();
    } catch (error) { flash((error as Error).message); } finally { setBusy(""); }
  };
  const remove = async (content: Content) => {
    if (!confirm(`‘${content.title}’을(를) 삭제할까요?`)) return;
    try { await api(`/api/contents/${content.id}`, { method: "DELETE" }); await onRefresh(); flash("콘텐츠를 삭제했습니다."); } catch (error) { flash((error as Error).message); }
  };
  return <section className="page-stack">
    <div className="stats-grid">
      <article className="stat featured"><span>전체 콘텐츠</span><strong>{data.contents.length}</strong><small>아이디어부터 발행 준비까지</small></article>
      <article className="stat"><span>초안</span><strong>{data.contents.filter((x) => x.status === "draft").length}</strong><small>검토가 필요한 콘텐츠</small></article>
      <article className="stat"><span>발행 준비</span><strong>{data.contents.filter((x) => x.status === "publish_ready").length}</strong><small>네이버 작성 화면에 전달됨</small></article>
      <article className="stat"><span>카테고리</span><strong>{data.categories.length}</strong><small>각각의 메모리 적용</small></article>
    </div>
    <div className="panel table-panel">
      <div className="panel-heading"><div><h2>저장된 콘텐츠</h2><p>생성한 글을 검토하고 발행 준비 상태로 옮기세요.</p></div><div className="filters"><input className="search" placeholder="제목이나 주제 검색" value={search} onChange={(e) => setSearch(e.target.value)} /><select value={filterCategory} onChange={(e) => setFilterCategory(Number(e.target.value))}><option value={0}>모든 카테고리</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div></div>
      {contents.length ? <div className="table-wrap"><table><thead><tr><th>날짜</th><th>카테고리</th><th>주제와 제목</th><th>본문 요약</th><th>상태</th><th /></tr></thead><tbody>{contents.map((content) => <tr key={content.id}>
        <td className="date">{dateText(content.createdAt)}</td><td><span className={`category-pill ${content.category.color}`}>{content.category.name}</span></td>
        <td className="title-cell"><small>{content.topic}</small><b>{content.title}</b></td><td className="summary">{content.summary || "요약이 없습니다."}</td>
        <td><span className={`status ${content.status}`}>{content.status === "publish_ready" ? "발행 준비" : "초안"}</span></td>
        <td><div className="row-actions"><button onClick={() => onPreview(content)}>미리보기</button><button onClick={() => preparePublish(content)}>게시 준비{content.images?.length ? ` · 사진 ${content.images.length}장` : ""}</button><button className="danger-text" onClick={() => remove(content)}>삭제</button></div></td>
      </tr>)}</tbody></table></div> : <div className="empty"><div>✦</div><h3>아직 저장된 콘텐츠가 없습니다</h3><p>새 콘텐츠에서 첫 글을 만들어 보세요.</p></div>}
    </div>
  </section>;
}

function CreatePanel({ data, onManageMemory, onCreated, busy, setBusy, flash }: { data: Data; onManageMemory: () => void; onCreated: (content: Content) => void; busy: string; setBusy: (v: string) => void; flash: (v: string) => void }) {
  const [categoryId, setCategoryId] = useState(data.categories[0]?.id || 0);
  const [templateId, setTemplateId] = useState(data.templates[0]?.id || 0);
  const [topic, setTopic] = useState("");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [lengthMode, setLengthMode] = useState<"short" | "standard" | "deep">("standard");
  const [imageInstructions, setImageInstructions] = useState("");
  const [imageReferences, setImageReferences] = useState<string[]>([]);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const selectedCategory = data.categories.find((c) => c.id === categoryId) || data.categories[0];
  const [expandedInstruction, setExpandedInstruction] = useState<"topic" | "image" | null>(null);
  const selected = data.templates.find((t) => t.id === templateId);
  const [autoImageCount, setAutoImageCount] = useState(selected?.blocks.filter((block) => block.type === "image").length || 0);
  useEffect(() => { setAutoImageCount(selected?.blocks.filter((block) => block.type === "image").length || 0); }, [templateId]);
  const uploadReferenceFiles = async (files: File[]) => {
    const available = 5 - imageReferences.length;
    const images = files.filter((file) => file.type.startsWith("image/")).slice(0, available);
    if (!images.length) return flash(available ? "이미지 파일을 붙여 넣어 주세요." : "레퍼런스 이미지는 최대 5장까지 사용할 수 있어요.");
    const form = new FormData();
    images.forEach((file) => form.append("images", file));
    setReferenceUploading(true);
    try {
      const response = await fetch("/api/reference-images", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "레퍼런스 이미지를 저장하지 못했습니다.");
      setImageReferences((current) => [...current, ...result.images.map((image: { url: string }) => image.url)].slice(0, 5));
      flash(`${result.images.length}장의 레퍼런스 이미지를 추가했습니다.`);
    } catch (error) { flash((error as Error).message); } finally { setReferenceUploading(false); }
  };
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
      if (files.length) { event.preventDefault(); void uploadReferenceFiles(files); }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [imageReferences.length]);
  const expandedTitle = expandedInstruction === "image" ? "이미지 생성 지침" : "이번 주제 추가 지침";
  const expandedDescription = expandedInstruction === "image" ? "이번 글과 함께 생성할 모든 이미지에 적용됩니다." : "현재 생성할 글에만 적용되고 별도로 저장되지 않습니다.";
  const expandedValue = expandedInstruction === "image" ? imageInstructions : extraInstructions;
  const setExpandedValue = (value: string) => {
    if (expandedInstruction === "image") setImageInstructions(value);
    else setExtraInstructions(value);
  };
  const applyExpandedInstruction = () => {
    flash(expandedInstruction === "image" ? "이미지 생성 지침에 적용했습니다." : "이번 주제 추가 지침에 적용했습니다.");
    setExpandedInstruction(null);
  };
  const generate = async () => {
    if (!topic.trim()) return flash("글 주제를 입력해 주세요.");
    setBusy("Codex가 글을 작성하고 있습니다");
    try {
      const content = await api<Content>("/api/generate", { method: "POST", body: JSON.stringify({ categoryId, templateId, topic, extraInstructions, imageInstructions, imageReferences, lengthMode }) });
      let completedContent = content;
      if (autoImageCount > 0) {
        try {
          const imageResult = await generateImagesOneByOne({ contentId: content.id, count: autoImageCount, style: "clean", imageInstructions }, (current, total) => setBusy(`${current}/${total}번째 블로그 이미지 제작 중`));
          completedContent = { ...content, ...imageResult };
        } catch (imageError) { flash(`글은 저장했지만 이미지 생성에 실패했습니다: ${(imageError as Error).message}`); }
      }
      flash("콘텐츠를 생성하고 보관함에 저장했습니다."); onCreated(completedContent);
    } catch (error) { flash((error as Error).message); } finally { setBusy(""); }
  };
  return <><section className="create-layout">
    <div className="panel form-panel"><div className="panel-heading"><div><span className="step">01</span><h2>이번 글을 알려주세요</h2><p>공통 지침, 카테고리 지침, 이번 주제 지침을 함께 적용합니다.</p></div></div>
      <label>카테고리<div className="category-select-row"><select value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button type="button" className="add-category-button" onClick={onManageMemory}>카테고리 관리</button></div><small>추가·이름 변경·지침 관리는 메모리 탭에서 한 번에 처리해요.</small></label>
      <label>글 주제<input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예: 병원 블로그에서 환자의 질문을 콘텐츠로 만드는 법" /></label>
      <div className="instruction-stack">
        <section className="instruction-card common readonly"><div className="instruction-title"><div><span>메모리에서 자동 적용</span><b>전체 공통 지침</b></div><div className="instruction-actions"><button type="button" className="expand" onClick={onManageMemory}>관리</button></div></div><div className="memory-summary">{data.settings.globalMemory || "설정된 공통 지침이 없습니다."}</div><small>모든 글에 자동 적용돼요.</small></section>
        <section className="instruction-card category readonly"><div className="instruction-title"><div><span>선택 카테고리에 자동 적용</span><b>{selectedCategory?.name || "선택 카테고리"} 지침</b></div><div className="instruction-actions"><button type="button" className="expand" onClick={onManageMemory}>관리</button></div></div><div className="memory-summary">{selectedCategory?.memory || "설정된 카테고리 지침이 없습니다."}</div><small>선택한 카테고리에서만 적용돼요.</small></section>
        <section className="instruction-card topic"><div className="instruction-title"><div><span>이번 글만</span><b>주제 추가 지침 <em>선택</em></b></div><div className="instruction-actions"><button type="button" className="expand" onClick={() => setExpandedInstruction("topic")}>크게 보기</button></div></div><textarea className="compact-instruction" rows={1} wrap="off" value={extraInstructions} onChange={(e) => setExtraInstructions(e.target.value)} placeholder="이번 글에 꼭 포함할 내용, 원하는 분량, 특별히 피할 표현" /><small>현재 주제로 생성하는 이 글에만 적용돼요.</small></section>
        <section className="instruction-card image-instruction"><div className="instruction-title"><div><span>이번 글 이미지 전용</span><b>추가 이미지 지침 <em>선택</em></b></div><div className="instruction-actions"><button type="button" className="expand" onClick={() => setExpandedInstruction("image")}>크게 보기</button></div></div><textarea className="compact-instruction" rows={1} wrap="off" value={imageInstructions} onChange={(e) => setImageInstructions(e.target.value)} placeholder="공통·카테고리 지침에 덧붙일 장면이나 피할 요소" /><small>저장된 이미지 지침 위에 이번 글 요청을 추가해요.</small></section>
      </div>
      <section className="reference-uploader" tabIndex={0} onPaste={(event) => { const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); event.stopPropagation(); void uploadReferenceFiles(files); } }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void uploadReferenceFiles(Array.from(event.dataTransfer.files)); }}>
        <div className="reference-head"><div><span>이미지 생성 참고용</span><b>레퍼런스 이미지 <em>선택 · 최대 5장</em></b><small>캡처 후 이 박스를 누르고 Ctrl+V 하거나 파일을 끌어다 놓으세요.</small></div><label className="reference-pick">{referenceUploading ? "올리는 중…" : "파일 선택"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={referenceUploading || imageReferences.length >= 5} onChange={(event) => { void uploadReferenceFiles(Array.from(event.target.files || [])); event.target.value = ""; }} /></label></div>
        {imageReferences.length ? <div className="reference-grid">{imageReferences.map((url, index) => <figure key={url}><img src={url} alt={`레퍼런스 이미지 ${index + 1}`} /><button type="button" aria-label={`레퍼런스 이미지 ${index + 1} 제거`} onClick={() => setImageReferences(imageReferences.filter((item) => item !== url))}>×</button><figcaption>참고 {index + 1}</figcaption></figure>)}</div> : <div className="reference-empty"><b>이미지를 여기에 붙여넣기</b><span>JPG · PNG · WebP · GIF, 장당 10MB 이하</span></div>}
      </section>
    </div>
    <div className="panel structure-preview"><div className="panel-heading"><div><span className="step">02</span><h2>글 구조를 선택하세요</h2></div></div>
      <select value={templateId} onChange={(e) => setTemplateId(Number(e.target.value))}>{data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <p className="template-desc">{selected?.description}</p><div className="mini-blocks">{selected?.blocks.map((block, i) => <div key={`${block.type}-${i}`}><span>{String(i + 1).padStart(2, "0")}</span><div><b>{block.label}</b><small>{block.instruction || "자연스럽게 작성"}</small></div></div>)}</div>
      <div className="create-image-count"><div><b>글 분량</b><small>기본은 사진 사이에서 부담 없이 읽히는 길이예요.</small></div><select className="content-length-select" value={lengthMode} onChange={(event) => setLengthMode(event.target.value as "short" | "standard" | "deep")}><option value="short">짧게 · 900~1,200자</option><option value="standard">기본 · 1,400~1,900자</option><option value="deep">자세히 · 2,200~3,000자</option></select></div>
      <div className="create-image-count"><div><b>이미지 자동 생성</b><small>글과 함께 만들 이미지 수를 선택하세요.</small></div><select value={autoImageCount} onChange={(event) => setAutoImageCount(Number(event.target.value))}><option value={0}>생성 안 함</option><option value={1}>1장</option><option value={2}>2장</option><option value={3}>3장</option><option value={4}>4장</option><option value={5}>5장</option></select></div>
      <button className="primary generate" onClick={generate} disabled={!!busy}>✦ 콘텐츠 생성하기</button><small className="center-note">생성 결과는 자동 게시되지 않고 보관함에 저장됩니다.</small>
    </div>
  </section>{expandedInstruction && <div className="instruction-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpandedInstruction(null); }}><div className="instruction-modal"><header><div><span>이번 글만 적용</span><h2>{expandedTitle}</h2><p>{expandedDescription}</p></div><button type="button" onClick={() => setExpandedInstruction(null)}>×</button></header><textarea autoFocus value={expandedValue} onChange={(event) => setExpandedValue(event.target.value)} placeholder={expandedInstruction === "image" ? "예: 파란색과 흰색 중심, 사람 얼굴은 제외, 자연광 사진, 이미지 안에 글자 금지" : "AI가 이해할 수 있도록 자유롭게 자세히 작성하세요."} /><footer><span>{expandedValue.length.toLocaleString()}자</span><div><button type="button" className="secondary" onClick={() => setExpandedInstruction(null)}>닫기</button><button type="button" className="primary" onClick={applyExpandedInstruction}>적용</button></div></footer></div></div>}</>;
}

function MemoryPanel({ data, onRefresh, flash }: { data: Data; onRefresh: () => Promise<void>; flash: (v: string) => void }) {
  const [selectedId, setSelectedId] = useState(data.categories[0]?.id || 0);
  const selected = data.categories.find((c) => c.id === selectedId) || data.categories[0];
  const [globalMemory, setGlobalMemory] = useState(data.settings.globalMemory);
  const [globalImageMemory, setGlobalImageMemory] = useState(data.settings.globalImageMemory);
  const [name, setName] = useState(selected?.name || ""); const [memory, setMemory] = useState(selected?.memory || ""); const [imageMemory, setImageMemory] = useState(selected?.imageMemory || "");
  useEffect(() => { if (selected) { setName(selected.name); setMemory(selected.memory); setImageMemory(selected.imageMemory); } }, [selectedId]);
  const saveGlobal = async () => { try { await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...data.settings, globalMemory, globalImageMemory }) }); await onRefresh(); flash("전체 공통 지침을 저장했습니다."); } catch (e) { flash((e as Error).message); } };
  const saveCategory = async () => { try { await api(`/api/categories/${selected.id}`, { method: "PUT", body: JSON.stringify({ ...selected, name, memory, imageMemory }) }); await onRefresh(); flash("카테고리 지침을 저장했습니다."); } catch (e) { flash((e as Error).message); } };
  const addCategory = async () => { const newName = prompt("새 카테고리명을 입력해 주세요."); if (!newName) return; try { const c = await api<Category>("/api/categories", { method: "POST", body: JSON.stringify({ name: newName, memory: "", imageMemory: "" }) }); await onRefresh(); setSelectedId(c.id); flash("카테고리를 추가했습니다."); } catch (e) { flash((e as Error).message); } };
  const remove = async () => { if (!confirm(`‘${selected.name}’ 카테고리를 삭제할까요?`)) return; try { await api(`/api/categories/${selected.id}`, { method: "DELETE" }); await onRefresh(); setSelectedId(data.categories.find((c) => c.id !== selected.id)?.id || 0); flash("카테고리를 삭제했습니다."); } catch (e) { flash((e as Error).message); } };
  return <section className="memory-layout"><div className="panel category-list"><div className="panel-heading"><div><h2>카테고리</h2><p>글 성격별로 기억을 나눕니다.</p></div><button className="icon-button" onClick={addCategory}>＋</button></div>{data.categories.map((c) => <button key={c.id} className={c.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(c.id)}><span className={`color-dot ${c.color}`} /><div><b>{c.name}</b><small>{c.memory ? `${c.memory.slice(0, 42)}${c.memory.length > 42 ? "…" : ""}` : "메모리 없음"}</small></div><i>›</i></button>)}</div>
    <div className="memory-main"><div className="panel memory-card"><div className="panel-heading"><div><span className="tag">항상 적용</span><h2>전체 공통 지침</h2><p>글과 이미지에 적용할 기본 원칙을 한 곳에서 관리합니다.</p></div></div><label>공통 글쓰기 지침<textarea rows={7} value={globalMemory} onChange={(e) => setGlobalMemory(e.target.value)} /></label><label>공통 이미지 생성 지침<textarea rows={6} value={globalImageMemory} onChange={(e) => setGlobalImageMemory(e.target.value)} placeholder="모든 카테고리의 이미지에 적용할 현실감, 구도, 금지 요소" /></label><div className="align-right"><button className="primary" onClick={saveGlobal}>공통 지침 저장</button></div></div>
      {selected && <div className="panel memory-card"><div className="panel-heading"><div><span className="tag soft">선택 카테고리</span><h2>카테고리 전용 지침</h2><p>독자, 톤, 금지사항과 이미지 방향을 카테고리별로 지정합니다.</p></div><button className="danger-text" onClick={remove}>카테고리 삭제</button></div><label>카테고리명<input value={name} onChange={(e) => setName(e.target.value)} /></label><label>글쓰기 지침<textarea rows={12} value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="주요 독자, 글의 목적, 톤, 포함할 내용과 금지사항" /></label><label>이미지 생성 지침<textarea rows={8} value={imageMemory} onChange={(e) => setImageMemory(e.target.value)} placeholder="이 카테고리에 맞는 장면, 촬영 방식과 피할 표현" /></label><div className="align-right"><button className="primary" onClick={saveCategory}>카테고리 지침 저장</button></div></div>}
    </div></section>;
}

function TemplatesPanel({ data, onRefresh, flash }: { data: Data; onRefresh: () => Promise<void>; flash: (v: string) => void }) {
  const [selectedId, setSelectedId] = useState(data.templates[0]?.id || 0);
  const current = data.templates.find((t) => t.id === selectedId);
  const [name, setName] = useState(current?.name || ""); const [description, setDescription] = useState(current?.description || ""); const [blocks, setBlocks] = useState<Block[]>(current?.blocks || []);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  useEffect(() => { const t = data.templates.find((x) => x.id === selectedId); if (t) { setName(t.name); setDescription(t.description); setBlocks(t.blocks.map((b) => ({ ...b }))); } }, [selectedId, data.templates]);
  const move = (from: number, to: number) => { const next = [...blocks]; const [item] = next.splice(from, 1); next.splice(to, 0, item); setBlocks(next); };
  const save = async () => { try { const method = selectedId ? "PUT" : "POST"; const url = selectedId ? `/api/templates/${selectedId}` : "/api/templates"; const result = await api<Template>(url, { method, body: JSON.stringify({ name, description, blocks }) }); await onRefresh(); setSelectedId(result.id); flash("구조 템플릿을 저장했습니다."); } catch (e) { flash((e as Error).message); } };
  const create = () => { setSelectedId(0); setName("새 구조 템플릿"); setDescription(""); setBlocks([]); };
  const removeTemplate = async () => { if (!selectedId || !confirm(`‘${name}’ 템플릿을 삭제할까요?`)) return; try { await api(`/api/templates/${selectedId}`, { method: "DELETE" }); await onRefresh(); setSelectedId(data.templates.find((t) => t.id !== selectedId)?.id || 0); flash("템플릿을 삭제했습니다."); } catch (e) { flash((e as Error).message); } };
  return <section className="template-layout"><div className="panel template-sidebar"><div className="panel-heading"><div><h2>저장 템플릿</h2><p>자주 쓰는 글 흐름을 보관합니다.</p></div><button className="icon-button" onClick={create}>＋</button></div>{data.templates.map((t) => <button key={t.id} className={t.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(t.id)}><b>{t.name}</b><small>{t.blocks.length}개 블록 · {t.description}</small></button>)}</div>
    <div className="panel template-editor"><div className="editor-head"><div><span className="eyebrow">STRUCTURE BUILDER</span><input className="title-input" value={name} onChange={(e) => setName(e.target.value)} /></div><div><button className="danger-text" onClick={removeTemplate} disabled={!selectedId}>삭제</button><button className="primary" onClick={save}>템플릿 저장</button></div></div><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="이 구조를 언제 사용하는지 한 줄로 설명하세요." />
      <div className="palette"><span>블록 추가</span>{blockPalette.map(([type, label]) => <button key={type} onClick={() => setBlocks([...blocks, { type, label, instruction: "" }])}>＋ {label}</button>)}</div>
      <div className="blocks-editor">{blocks.length ? blocks.map((block, index) => <div className={`block-card ${block.type === "image" ? "image-block" : ""}`} key={`${block.type}-${index}`} draggable onDragStart={() => setDragIndex(index)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragIndex !== null && dragIndex !== index) move(dragIndex, index); setDragIndex(null); }}><span className="drag">⠿</span><span className="block-number">{block.type === "image" ? "🖼" : String(index + 1).padStart(2, "0")}</span><div><input value={block.label} onChange={(e) => setBlocks(blocks.map((b, i) => i === index ? { ...b, label: e.target.value } : b))} /><textarea rows={2} value={block.instruction} onChange={(e) => setBlocks(blocks.map((b, i) => i === index ? { ...b, instruction: e.target.value } : b))} placeholder={block.type === "image" ? "이 위치에 만들 이미지의 내용과 목적" : "이 블록에 적용할 자유 지시문"} /></div><button className="remove-block" aria-label="블록 삭제" onClick={() => setBlocks(blocks.filter((_, i) => i !== index))}>×</button></div>) : <div className="drop-empty">위의 블록 버튼을 눌러 글 구조를 만드세요.</div>}</div>
    </div></section>;
}

function SettingsPanel({ data, onRefresh, flash }: { data: Data; onRefresh: () => Promise<void>; flash: (v: string) => void }) {
  const [form, setForm] = useState(data.settings); const [testing, setTesting] = useState(false);
  const update = (key: keyof Settings, value: string) => setForm({ ...form, [key]: value });
  const save = async () => { try { await api("/api/settings", { method: "PUT", body: JSON.stringify(form) }); await onRefresh(); flash("설정을 저장했습니다."); } catch (e) { flash((e as Error).message); } };
  const test = async () => { setTesting(true); try { const result = await api<{ message: string }>("/api/settings", { method: "POST" }); flash(`연결 성공: ${result.message}`); } catch (e) { flash((e as Error).message); } finally { setTesting(false); } };
  return <section className="settings-grid"><div className="panel settings-card"><div className="panel-heading"><div><span className="tag">AI</span><h2>Codex CLI 연결</h2><p>API 키 대신 이 PC의 Codex 로그인 세션을 사용합니다.</p></div></div><label>실행 명령<input value={form.cliCommand} onChange={(e) => update("cliCommand", e.target.value)} placeholder="codex" /></label><label>추가 실행 옵션 <span className="optional">선택</span><input value={form.cliExtraArgs} onChange={(e) => update("cliExtraArgs", e.target.value)} placeholder="예: --model 모델명" /></label><div className="info-box">Codex CLI가 설치되고 로그인된 상태여야 합니다. 생성 중에는 외부 도구를 쓰지 않는 읽기 전용 모드로 실행됩니다.</div><button className="secondary" onClick={test} disabled={testing}>{testing ? "확인 중…" : "Codex 연결 테스트"}</button></div>
    <div className="panel settings-card"><div className="panel-heading"><div><span className="tag soft">게시 준비</span><h2>네이버 블로그</h2><p>로그인된 Chrome 작성 화면에 제목과 본문을 채웁니다.</p></div></div><label>블로그 ID<input value={form.naverBlogId} onChange={(e) => update("naverBlogId", e.target.value)} placeholder="네이버 블로그 ID" /></label><label>Chrome 디버깅 주소<input value={form.chromeDebugUrl} onChange={(e) => update("chromeDebugUrl", e.target.value)} /></label><label className="toggle-setting"><input type="checkbox" checked={form.autoWebReferences} onChange={(event) => setForm({ ...form, autoWebReferences: event.target.checked })} /><span><b>웹 이미지 레퍼런스 자동 수집</b><small>검색 이미지 약 20장을 검토하고 주제에 가장 맞는 최대 5장만 생성 참고용으로 사용합니다.</small></span></label><div className="warning-box">검색과 게시 준비는 Chrome 디버깅 세션으로만 실행합니다. 보안 확인이 나타나면 우회하지 않고 중단합니다. 최종 게시 버튼은 사용자가 직접 눌러 주세요.</div></div>
    <div className="settings-actions"><button className="primary" onClick={save}>연결 설정 저장</button></div></section>;
}

function PreviewModal({ content, data, onClose, onSaved, flash }: { content: Content; data: Data; onClose: () => void; onSaved: (c: Content) => void; flash: (v: string) => void }) {
  const [draft, setDraft] = useState<Content>({ ...content, blocks: content.blocks.map((block) => ({ ...block })), images: content.images || [] });
  const [working, setWorking] = useState(0);
  const [imageWorking, setImageWorking] = useState(false);
  const [imageProgress, setImageProgress] = useState(0);
  const [imageCount, setImageCount] = useState(1);
  const [imageStyle, setImageStyle] = useState("clean");
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  const [rewriting, setRewriting] = useState(false);
  const imageBlocks = draft.blocks.filter((block) => block.type === "image");
  const save = async () => {
    try {
      const saved = await api<Content>(`/api/contents/${draft.id}`, { method: "PUT", body: JSON.stringify(draft) });
      const merged = { ...saved, images: draft.images || [] };
      onSaved(merged); setDraft(merged); flash("수정 내용을 저장했습니다.");
    } catch (error) { flash((error as Error).message); }
  };
  const regenerate = async (block: Block) => {
    if (!block.id) return;
    const instruction = prompt("이 블록을 어떻게 바꿀까요? (비워두면 기존 지시로 재생성)") || "";
    setWorking(block.id);
    try {
      const updated = await api<Content>("/api/regenerate", { method: "POST", body: JSON.stringify({ contentId: draft.id, blockId: block.id, instruction }) });
      const merged = { ...updated, images: draft.images || [] };
      setDraft(merged); onSaved(merged); flash("블록을 다시 작성했습니다.");
    } catch (error) { flash((error as Error).message); } finally { setWorking(0); }
  };
  const generateImages = async () => {
    setImageWorking(true);
    setImageProgress(0);
    try {
      const result = await generateImagesOneByOne({ contentId: draft.id, count: imageCount, style: imageStyle }, (current) => setImageProgress(current));
      const updated = { ...draft, ...result };
      setDraft(updated); onSaved(updated); flash("블로그 이미지를 생성했습니다.");
    } catch (error) { flash((error as Error).message); } finally { setImageWorking(false); setImageProgress(0); }
  };
  const rewriteShort = async () => {
    if (!confirm("현재 글을 900~1,200자 분량으로 짧게 다시 쓸까요? 생성된 이미지는 그대로 유지됩니다.")) return;
    setRewriting(true);
    try {
      const updated = await api<Content>("/api/rewrite", { method: "POST", body: JSON.stringify({ contentId: draft.id, lengthMode: "short" }) });
      setDraft(updated); onSaved(updated); flash("중복 설명을 걷어내고 짧은 네이버형 글로 다시 작성했습니다.");
    } catch (error) { flash((error as Error).message); } finally { setRewriting(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="preview-modal">
    <header><div><span className={`category-pill ${draft.category.color}`}>{draft.category.name}</span><span className="date">{dateText(draft.updatedAt)}</span></div><button className="close" onClick={onClose}>×</button></header>
    <div className="preview-grid"><section className="article-editor"><div className="preview-mode-switch"><button className={viewMode === "preview" ? "active" : ""} onClick={() => setViewMode("preview")}>네이버형 미리보기</button><button className={viewMode === "edit" ? "active" : ""} onClick={() => setViewMode("edit")}>블록 편집</button></div>
      {viewMode === "preview" ? <NaverStylePreview content={draft} /> : <>
      <label>제목<input className="preview-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>본문 요약<textarea rows={2} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
      {(draft.images || []).some((image) => image.placementOrder < 0) && <div className="generated-images"><div className="section-label"><b>대표 이미지</b><span>{draft.images?.filter((image) => image.placementOrder < 0).length}장</span></div><div className="image-grid">{draft.images?.filter((image) => image.placementOrder < 0).map((image) => <figure key={image.id}><img src={image.url} alt={`${draft.title} 대표 이미지`} /><figcaption>{image.prompt}</figcaption></figure>)}</div></div>}
      <div className="preview-blocks">{draft.blocks.map((block, index) => block.type === "image" ? <article className="image-position-card" key={block.id || index}><div className="block-toolbar"><span>{String(index + 1).padStart(2, "0")}</span><b>🖼 {block.label}</b><em>이 위치에 이미지 표시</em></div>{(draft.images || []).filter((image) => image.placementOrder === (block.sortOrder ?? index)).length > 0 ? <div className="image-grid inline">{draft.images?.filter((image) => image.placementOrder === (block.sortOrder ?? index)).map((image) => <figure key={image.id}><img src={image.url} alt={`${block.label} 이미지`} /><figcaption>{image.prompt}</figcaption></figure>)}</div> : <div className="image-placeholder"><b>이미지 생성 위치</b><span>{block.instruction || block.text || "이 블록의 앞뒤 내용에 어울리는 이미지"}</span></div>}<textarea rows={3} value={block.text} onChange={(event) => setDraft({ ...draft, blocks: draft.blocks.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) })} placeholder="AI가 작성한 이미지 묘사 또는 직접 입력할 생성 지침" /></article> : <article key={block.id || index}><div className="block-toolbar"><span>{String(index + 1).padStart(2, "0")}</span><b>{block.label}</b><button onClick={() => regenerate(block)} disabled={working === block.id}>{working === block.id ? "작성 중…" : "✦ 이 블록 재생성"}</button></div><textarea rows={Math.max(5, Math.ceil((block.text?.length || 0) / 55))} value={block.text} onChange={(event) => setDraft({ ...draft, blocks: draft.blocks.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) })} /></article>)}</div></>}
    </section><aside className="preview-info"><PublishingBlueprint content={draft} /><h3 className="info-heading">글 정보</h3>
      <label>카테고리<select value={draft.categoryId} onChange={(event) => { const categoryId = Number(event.target.value); setDraft({ ...draft, categoryId, category: data.categories.find((category) => category.id === categoryId)! }); }}>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>주제<textarea rows={4} value={draft.topic} onChange={(event) => setDraft({ ...draft, topic: event.target.value })} /></label>
      <label>추가 지시<textarea rows={5} value={draft.extraInstructions} onChange={(event) => setDraft({ ...draft, extraInstructions: event.target.value })} /></label>
      <label>이번 글 이미지 지침<textarea rows={4} value={draft.imageInstructions} onChange={(event) => setDraft({ ...draft, imageInstructions: event.target.value })} placeholder="공통·카테고리 이미지 지침에 덧붙일 요청" /></label>
      <div className={`preview-references ${draft.imageReferences.length ? "" : "empty"}`}><b>이미지 레퍼런스 출처</b>{draft.imageReferences.length > 0 ? <><div>{draft.imageReferences.map((url, index) => { const source = (draft.imageReferenceSources || []).find((item) => item.url === url); return <figure key={url}><img src={url} alt={`적용 중인 레퍼런스 ${index + 1}`} /><figcaption><strong>{source?.kind === "web" ? sourceHost(source.sourcePageUrl || source.originalImageUrl) : "사용자 제공"}</strong>{source?.title && <span title={source.title}>{source.title}</span>}<nav>{source?.sourcePageUrl && <a href={source.sourcePageUrl} target="_blank" rel="noreferrer">출처 페이지</a>}{source?.originalImageUrl && <a href={source.originalImageUrl} target="_blank" rel="noreferrer">원본 이미지</a>}{source?.kind === "web" && !source.sourcePageUrl && !source.originalImageUrl && <em>출처 미기록</em>}</nav></figcaption></figure>; })}</div><small>자동 선정된 웹 이미지는 출처 링크를 보존합니다. 원본을 게시하지 않고 생성 참고용으로만 사용합니다.</small></> : <div className="reference-source-empty"><strong>참고한 외부 이미지 없음</strong><span>이 글의 이미지는 저장된 웹·사용자 레퍼런스 없이 글 내용과 이미지 지침만으로 생성됐습니다.</span></div>}</div>
      <div className="image-generator"><div><span className="image-badge">추가 생성</span><h3>이미지 추가 제작</h3><p>{imageBlocks.length ? `구조 템플릿에 지정된 ${imageBlocks.length}개 위치를 기준으로 추가 시안을 만들어요.` : "저장된 글의 제목과 본문을 읽고 이미지를 추가해요."}</p></div>{imageBlocks.length > 0 && <div className="detected-positions"><b>템플릿 이미지 위치</b>{imageBlocks.map((block, index) => <span key={block.id || index}>{index + 1}. {block.label}</span>)}</div>}<label>추가할 이미지 수<select value={imageCount} onChange={(event) => setImageCount(Number(event.target.value))}><option value={1}>1장</option><option value={2}>2장</option><option value={3}>3장</option><option value={4}>4장</option><option value={5}>5장</option></select></label><label>스타일<select value={imageStyle} onChange={(event) => setImageStyle(event.target.value)}><option value="clean">깔끔한 에디토리얼</option><option value="photo">사실적인 사진</option><option value="illustration">친근한 일러스트</option><option value="infographic">미니멀 인포그래픽</option></select></label>{imageWorking && <div className="image-progress"><div><span style={{ width: `${(imageProgress / imageCount) * 100}%` }} /></div><b>{imageProgress}/{imageCount}번째 이미지 제작 중</b></div>}<button className="primary image-generate-button" onClick={generateImages} disabled={imageWorking}>{imageWorking ? `${imageProgress}/${imageCount}번째 제작 중…` : `${imageCount}장 추가 생성`}</button><small>처음 생성할 이미지 수와 지침은 새 콘텐츠 탭에서 정합니다.</small></div>
      <div className="info-box">각 블록을 직접 고치거나 해당 블록만 Codex로 다시 작성할 수 있습니다.</div>
    </aside></div>
    <footer><button className="secondary" onClick={rewriteShort} disabled={rewriting}>{rewriting ? "짧게 다시 쓰는 중…" : "✦ 전체 글 짧게 다시 쓰기"}</button><button className="secondary" onClick={onClose}>닫기</button><button className="primary" onClick={save}>수정 내용 저장</button></footer>
  </div></div>;
}
