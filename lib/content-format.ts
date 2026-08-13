const listLine = /^\s*(?:[-*•]|\d+[.)]|[①-⑳]|[가-하][.)]|✔|✅|☑)\s*/;

function sentenceChunks(value: string) {
  return value.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [value];
}

export function formatBlogBlockText(value: string) {
  const normalized = value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!normalized) return "";

  return normalized.split(/\n{2,}/).flatMap((paragraph) => {
    const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    if (lines.some((line) => listLine.test(line))) return [lines.join("\n")];

    // Keep deliberate short-line rhythm from the model instead of flattening it.
    if (lines.length > 1 && lines.every((line) => line.length <= 48)) return lines;

    const sentences = sentenceChunks(lines.join(" "));
    return sentences;
  }).join("\n\n");
}
