-- Anbieter je Tarif und bis zu zwei Boni (z. B. Neukunden- und Sofortbonus)
-- AlterTable
ALTER TABLE "Tariff" ADD COLUMN "provider" TEXT;

-- CreateTable
CREATE TABLE "TariffBonus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tariffId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    CONSTRAINT "TariffBonus_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TariffBonus_tariffId_idx" ON "TariffBonus"("tariffId");

