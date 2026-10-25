-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Photo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "meterId" TEXT,
    "takenAt" DATETIME NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "ocrStatus" TEXT NOT NULL DEFAULT 'NONE',
    "ocrResult" TEXT,
    "cropped" BOOLEAN NOT NULL DEFAULT false,
    "keepFull" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Photo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Photo_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Photo" ("createdAt", "cropped", "height", "id", "meterId", "ocrResult", "ocrStatus", "takenAt", "userId", "width") SELECT "createdAt", "cropped", "height", "id", "meterId", "ocrResult", "ocrStatus", "takenAt", "userId", "width" FROM "Photo";
DROP TABLE "Photo";
ALTER TABLE "new_Photo" RENAME TO "Photo";
CREATE INDEX "Photo_meterId_idx" ON "Photo"("meterId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
