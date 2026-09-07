-- Discussion 级权限配置
ALTER TABLE "Discussion" ADD COLUMN "permissionMode" TEXT NOT NULL DEFAULT 'read-only';
ALTER TABLE "Discussion" ADD COLUMN "approvalPolicy" TEXT NOT NULL DEFAULT 'ask';

-- AgentEvent 的 Discussion 内游标与原生事件时间；历史记录先允许为空，随后回填游标。
ALTER TABLE "AgentEvent" ADD COLUMN "discussionSeq" INTEGER;
ALTER TABLE "AgentEvent" ADD COLUMN "eventTimeMs" REAL;

-- 保存 Discussion 级跨 Session 序号的下一个值。
CREATE TABLE "DiscussionEventCursor" (
    "discussionId" TEXT NOT NULL PRIMARY KEY,
    "nextSeq" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "DiscussionEventCursor_discussionId_fkey"
      FOREIGN KEY ("discussionId") REFERENCES "Discussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 为已有事件按 Discussion、创建时间、id 建立稳定的历史顺序；不删除任何历史事件。
WITH numbered AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (PARTITION BY "discussionId" ORDER BY "createdAt" ASC, "id" ASC) AS "discussionSeq"
    FROM "AgentEvent"
)
UPDATE "AgentEvent"
SET "discussionSeq" = (
    SELECT "discussionSeq"
    FROM numbered
    WHERE numbered."id" = "AgentEvent"."id"
)
WHERE "id" IN (SELECT "id" FROM numbered);

INSERT INTO "DiscussionEventCursor" ("discussionId", "nextSeq")
SELECT d."id", COALESCE(MAX(e."discussionSeq"), 0) + 1
FROM "Discussion" d
LEFT JOIN "AgentEvent" e ON e."discussionId" = d."id"
GROUP BY d."id";

CREATE UNIQUE INDEX "DiscussionMessage_sourceEventId_key" ON "DiscussionMessage"("sourceEventId");
CREATE INDEX "AgentEvent_discussionId_discussionSeq_idx" ON "AgentEvent"("discussionId", "discussionSeq");
