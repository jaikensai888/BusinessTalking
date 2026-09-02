-- CreateTable
CREATE TABLE "Discussion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brief" TEXT NOT NULL,
    "rounds" INTEGER NOT NULL DEFAULT 5,
    "personaIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "summaryBox" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DiscussionMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "personaId" TEXT,
    "sender" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscussionMessage_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Discussion_status_idx" ON "Discussion"("status");

-- CreateIndex
CREATE INDEX "DiscussionMessage_discussionId_idx" ON "DiscussionMessage"("discussionId");
