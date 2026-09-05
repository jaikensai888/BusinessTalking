
-- CreateTable
CREATE TABLE "SkillRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT NOT NULL,
    "packageRoot" TEXT,
    "source" TEXT NOT NULL DEFAULT 'builtin',
    "sourceRef" TEXT,
    "manifest" JSONB,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillRevision_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiscussionParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "dshSessionId" TEXT NOT NULL,
    "personaSkillVersion" TEXT,
    "personaSkillHash" TEXT,
    "personaSnapshotRoot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastEventSeq" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiscussionParticipant_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiscussionSkill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "skillRevisionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscussionSkill_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DiscussionSkill_skillRevisionId_fkey" FOREIGN KEY ("skillRevisionId") REFERENCES "SkillRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "participantId" TEXT,
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentEvent_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiscussionTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "participantId" TEXT,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "inputSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "outputMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "DiscussionTurn_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Discussion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brief" TEXT NOT NULL,
    "rounds" INTEGER NOT NULL DEFAULT 5,
    "personaIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "summaryBox" TEXT,
    "attachmentName" TEXT,
    "attachmentCharCount" INTEGER,
    "attachmentTruncated" BOOLEAN,
    "shortId" TEXT,
    "runtimeMode" TEXT NOT NULL DEFAULT 'dsh',
    "runtimeProfile" JSONB,
    "discussionState" JSONB,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "moderatorSessionId" TEXT,
    "moderatorStatus" TEXT,
    "moderatorLastEventSeq" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "purgeAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Discussion" ("attachmentCharCount", "attachmentName", "attachmentTruncated", "brief", "createdAt", "id", "personaIds", "rounds", "shortId", "status", "summaryBox", "updatedAt") SELECT "attachmentCharCount", "attachmentName", "attachmentTruncated", "brief", "createdAt", "id", "personaIds", "rounds", "shortId", "status", "summaryBox", "updatedAt" FROM "Discussion";
DROP TABLE "Discussion";
ALTER TABLE "new_Discussion" RENAME TO "Discussion";
CREATE UNIQUE INDEX "Discussion_shortId_key" ON "Discussion"("shortId");
CREATE INDEX "Discussion_status_idx" ON "Discussion"("status");
CREATE INDEX "Discussion_archivedAt_idx" ON "Discussion"("archivedAt");
CREATE TABLE "new_DiscussionMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "personaId" TEXT,
    "sender" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "participantId" TEXT,
    "sessionId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "sourceEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscussionMessage_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DiscussionMessage" ("content", "createdAt", "discussionId", "id", "personaId", "role", "sender", "turn") SELECT "content", "createdAt", "discussionId", "id", "personaId", "role", "sender", "turn" FROM "DiscussionMessage";
DROP TABLE "DiscussionMessage";
ALTER TABLE "new_DiscussionMessage" RENAME TO "DiscussionMessage";
CREATE INDEX "DiscussionMessage_discussionId_idx" ON "DiscussionMessage"("discussionId");
CREATE INDEX "DiscussionMessage_discussionId_role_idx" ON "DiscussionMessage"("discussionId", "role");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SkillRevision_skillId_idx" ON "SkillRevision"("skillId");

-- CreateIndex
CREATE INDEX "SkillRevision_contentHash_idx" ON "SkillRevision"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "SkillRevision_name_version_key" ON "SkillRevision"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SkillRevision_name_contentHash_key" ON "SkillRevision"("name", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "DiscussionParticipant_dshSessionId_key" ON "DiscussionParticipant"("dshSessionId");

-- CreateIndex
CREATE INDEX "DiscussionParticipant_discussionId_idx" ON "DiscussionParticipant"("discussionId");

-- CreateIndex
CREATE INDEX "DiscussionParticipant_personaId_idx" ON "DiscussionParticipant"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscussionParticipant_discussionId_personaId_key" ON "DiscussionParticipant"("discussionId", "personaId");

-- CreateIndex
CREATE INDEX "DiscussionSkill_skillRevisionId_idx" ON "DiscussionSkill"("skillRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscussionSkill_discussionId_skillRevisionId_key" ON "DiscussionSkill"("discussionId", "skillRevisionId");

-- CreateIndex
CREATE INDEX "AgentEvent_discussionId_createdAt_idx" ON "AgentEvent"("discussionId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvent_sessionId_idx" ON "AgentEvent"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvent_sessionId_seq_key" ON "AgentEvent"("sessionId", "seq");

-- CreateIndex
CREATE INDEX "DiscussionTurn_discussionId_round_idx" ON "DiscussionTurn"("discussionId", "round");

-- CreateIndex
CREATE INDEX "DiscussionTurn_sessionId_idx" ON "DiscussionTurn"("sessionId");

