-- AlterTable
ALTER TABLE "Meter" ADD COLUMN "icon" TEXT;

-- Bestehende Heizstromzähler bekommen das Heizungssymbol
UPDATE "Meter" SET "icon" = 'HEATING' WHERE lower("name") LIKE '%heiz%';
