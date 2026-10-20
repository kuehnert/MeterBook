-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "device" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Meter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "medium" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "serialNumber" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "ocrHint" TEXT,
    "billingStartMonth" INTEGER NOT NULL DEFAULT 1,
    "billingStartDay" INTEGER NOT NULL DEFAULT 1,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Meter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Register" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "decimals" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Register_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registerId" TEXT NOT NULL,
    "readAt" DATETIME NOT NULL,
    "value" DECIMAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "photoId" TEXT,
    "ocrValue" DECIMAL,
    "ocrConfidence" REAL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reading_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "Register" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reading_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "takenAt" DATETIME NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "ocrStatus" TEXT NOT NULL DEFAULT 'NONE',
    "ocrResult" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Photo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Photo_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MeterExchange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registerId" TEXT NOT NULL,
    "exchangedAt" DATETIME NOT NULL,
    "oldFinalValue" DECIMAL NOT NULL,
    "newInitialValue" DECIMAL NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeterExchange_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "Register" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tariff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meterId" TEXT NOT NULL,
    "name" TEXT,
    "validFrom" DATETIME NOT NULL,
    "basePricePerMonth" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tariff_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TariffComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tariffId" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pricePerUnit" DECIMAL NOT NULL,
    CONSTRAINT "TariffComponent_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TariffComponent_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "Register" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdvancePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meterId" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "amountPerMonth" DECIMAL NOT NULL,
    "note" TEXT,
    CONSTRAINT "AdvancePayment_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Meter_userId_idx" ON "Meter"("userId");

-- CreateIndex
CREATE INDEX "Register_meterId_idx" ON "Register"("meterId");

-- CreateIndex
CREATE INDEX "Reading_registerId_readAt_idx" ON "Reading"("registerId", "readAt");

-- CreateIndex
CREATE INDEX "Photo_meterId_idx" ON "Photo"("meterId");

-- CreateIndex
CREATE INDEX "MeterExchange_registerId_idx" ON "MeterExchange"("registerId");

-- CreateIndex
CREATE INDEX "Tariff_meterId_validFrom_idx" ON "Tariff"("meterId", "validFrom");

-- CreateIndex
CREATE INDEX "TariffComponent_tariffId_idx" ON "TariffComponent"("tariffId");

-- CreateIndex
CREATE INDEX "AdvancePayment_meterId_validFrom_idx" ON "AdvancePayment"("meterId", "validFrom");
