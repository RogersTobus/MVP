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

    const sentences = sentenceChunks(lines.join(" "));
    if (sentences.length <= 2) return [sentences.join(" ")];

    const groups: string[] = [];
    let current: string[] = [];
    for (const sentence of sentences) {
      const nextLength = [...current, sentence].join(" ").length;
      if (current.length >= 2 || (current.length > 0 && nextLength > 150)) {
        groups.push(current.join(" "));
        current = [];
      }
      current.push(sentence);
    }
    if (current.length) groups.push(current.join(" "));
    return groups;
  }).join("\n\n");
}
