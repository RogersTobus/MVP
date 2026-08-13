import { CodexCliAdapter } from "./codex-cli";

export function createAiAdapter(settings: { cliCommand: string; cliExtraArgs: string }) {
  return new CodexCliAdapter(settings.cliCommand, settings.cliExtraArgs);
}

export type { AiAdapter, GenerateInput, GeneratedArticle, PromptBlock } from "./types";
