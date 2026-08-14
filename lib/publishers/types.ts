export type PublishBlock = {
  type: string;
  label: string;
  text: string;
  sortOrder: number;
  imagePaths: string[];
};

export type PublishDraft = {
  title: string;
  categoryName: string;
  coverImagePaths: string[];
  hashtags: string[];
  blocks: PublishBlock[];
};
export type PublishResult = { status: "ready" | "manual_required"; message: string; url?: string };

export interface BlogPublisher {
  prepareDraft(draft: PublishDraft): Promise<PublishResult>;
}
