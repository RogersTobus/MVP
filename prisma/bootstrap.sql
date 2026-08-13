PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS "AppSetting" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "globalMemory" TEXT NOT NULL DEFAULT '',
  "cliCommand" TEXT NOT NULL DEFAULT 'codex',
  "cliExtraArgs" TEXT NOT NULL DEFAULT '',
  "naverBlogId" TEXT NOT NULL DEFAULT '',
  "chromeDebugUrl" TEXT NOT NULL DEFAULT 'http://127.0.0.1:9222',
  "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "Category" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "memory" TEXT NOT NULL DEFAULT '',
  "color" TEXT NOT NULL DEFAULT 'sage',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "Category_name_key" ON "Category"("name");
CREATE TABLE IF NOT EXISTS "Template" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "TemplateBlock" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "templateId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "instruction" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "TemplateBlock_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TemplateBlock_templateId_sortOrder_idx" ON "TemplateBlock"("templateId", "sortOrder");
CREATE TABLE IF NOT EXISTS "Content" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "categoryId" INTEGER NOT NULL,
  "topic" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "summary" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL DEFAULT '',
  "extraInstructions" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "publishNote" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Content_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Content_createdAt_idx" ON "Content"("createdAt");
CREATE INDEX IF NOT EXISTS "Content_categoryId_createdAt_idx" ON "Content"("categoryId", "createdAt");
CREATE TABLE IF NOT EXISTS "ContentBlock" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "contentId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "instruction" TEXT NOT NULL DEFAULT '',
  "text" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "ContentBlock_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ContentBlock_contentId_sortOrder_idx" ON "ContentBlock"("contentId", "sortOrder");
CREATE TABLE IF NOT EXISTS "ContentImage" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "contentId" INTEGER NOT NULL,
  "prompt" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "style" TEXT NOT NULL DEFAULT 'clean',
  "placementOrder" INTEGER NOT NULL DEFAULT -1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentImage_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ContentImage_contentId_createdAt_idx" ON "ContentImage"("contentId", "createdAt");
PRAGMA optimize;
