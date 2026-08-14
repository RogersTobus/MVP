export type PromptBlock = {
  type: string;
  label: string;
  instruction: string;
};

export type GenerateInput = {
  globalMemory: string;
  categoryName: string;
  categoryMemory: string;
  topic: string;
  extraInstructions: string;
  personaName?: string;
  personaInstruction?: string;
  lengthMode?: "short" | "standard" | "deep";
  blocks: PromptBlock[];
};

export type GeneratedArticle = {
  title: string;
  summary: string;
  hashtags: string[];
  blocks: Array<{ type: string; label: string; text: string }>;
};

export type PersonaStyleSample = {
  blogId: string;
  title: string;
  url: string;
  text: string;
};

export type CreativePlanInput = {
  kind: "cardnews" | "ads";
  prompt: string;
  ratio: string;
  itemCount: number;
  destination: "canva" | "instagram" | "export";
  referenceCount: number;
};

export type CreativePlan = {
  title: string;
  concept: string;
  items: Array<{ headline: string; body: string; visualDirection: string }>;
  caption: string;
  exportChecklist: string[];
};

export interface AiAdapter {
  generate(input: GenerateInput): Promise<GeneratedArticle>;
  regenerateBlock(input: GenerateInput & { currentTitle: string; targetIndex: number; currentBlocks: GeneratedArticle["blocks"] }): Promise<{ text: string }>;
  generateCreativePlan(input: CreativePlanInput): Promise<CreativePlan>;
  test(): Promise<string>;
}
