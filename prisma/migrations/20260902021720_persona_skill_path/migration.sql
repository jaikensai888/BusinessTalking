/*
  Warnings:

  - You are about to drop the column `reference` on the `Persona` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Persona" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "skillPath" TEXT,
    "perspectiveType" TEXT NOT NULL DEFAULT 'custom',
    "avatarType" TEXT NOT NULL DEFAULT 'auto',
    "avatarValue" TEXT,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "tags" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Persona" ("avatarType", "avatarValue", "createdAt", "description", "id", "isBuiltin", "name", "perspectiveType", "systemPrompt", "tags", "updatedAt") SELECT "avatarType", "avatarValue", "createdAt", "description", "id", "isBuiltin", "name", "perspectiveType", "systemPrompt", "tags", "updatedAt" FROM "Persona";
DROP TABLE "Persona";
ALTER TABLE "new_Persona" RENAME TO "Persona";
CREATE INDEX "Persona_perspectiveType_idx" ON "Persona"("perspectiveType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
