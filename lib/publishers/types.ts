export type PublishDraft = { title: string; body: string };
export type PublishResult = { status: "ready" | "manual_required"; message: string; url?: string };

export interface BlogPublisher {
  prepareDraft(draft: PublishDraft): Promise<PublishResult>;
}
