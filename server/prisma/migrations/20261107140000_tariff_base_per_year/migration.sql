-- Grundpreis künftig pro Jahr statt pro Monat; bestehende Tarife werden umgerechnet (× 12).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Tariff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meterId" TEXT NOT NULL,
    "name" TEXT,
    "validFrom" DATETIME NOT NULL,
    "basePricePerYear" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tariff_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Tariff" ("createdAt", "id", "meterId", "name", "validFrom", "basePricePerYear")
    SELECT "createdAt", "id", "meterId", "name", "validFrom", ROUND("basePricePerMonth" * 12, 4) FROM "Tariff";
DROP TABLE "Tariff";
ALTER TABLE "new_Tariff" RENAME TO "Tariff";
CREATE INDEX "Tariff_meterId_validFrom_idx" ON "Tariff"("meterId", "validFrom");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
