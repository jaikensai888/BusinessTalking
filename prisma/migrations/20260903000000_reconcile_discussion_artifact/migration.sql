
-- AlterTable
ALTER TABLE "Discussion" ADD COLUMN "attachmentCharCount" INTEGER;
ALTER TABLE "Discussion" ADD COLUMN "attachmentName" TEXT;
ALTER TABLE "Discussion" ADD COLUMN "attachmentTruncated" BOOLEAN;
ALTER TABLE "Discussion" ADD COLUMN "shortId" TEXT;

-- CreateTable
CREATE TABLE "DiscussionArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'report',
    "filePath" TEXT,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscussionArtifact_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DiscussionArtifact_discussionId_idx" ON "DiscussionArtifact"("discussionId");

-- CreateIndex
CREATE UNIQUE INDEX "Discussion_shortId_key" ON "Discussion"("shortId");

