-- Discussion run lease
ALTER TABLE "Discussion" ADD COLUMN "activeRunId" TEXT;
ALTER TABLE "Discussion" ADD COLUMN "runLeaseUntil" DATETIME;

-- Bind durable turns to the orchestrator run that created them.
ALTER TABLE "DiscussionTurn" ADD COLUMN "runId" TEXT;
CREATE INDEX "DiscussionTurn_discussionId_runId_idx"
  ON "DiscussionTurn"("discussionId", "runId");

-- Durable Discussion-scoped capability decisions.
CREATE TABLE "DiscussionCapabilityGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "decidedAt" DATETIME,
    "decidedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiscussionCapabilityGrant_discussionId_fkey"
      FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DiscussionCapabilityGrant_discussionId_capability_key"
  ON "DiscussionCapabilityGrant"("discussionId", "capability");
CREATE INDEX "DiscussionCapabilityGrant_discussionId_status_idx"
  ON "DiscussionCapabilityGrant"("discussionId", "status");
