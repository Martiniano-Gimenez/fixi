-- CreateTable
CREATE TABLE "OverrideCanchasDia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "torneoId" TEXT NOT NULL,
    "diaKey" TEXT NOT NULL,
    "canchas" INTEGER NOT NULL,
    "isLluvia" BOOLEAN NOT NULL DEFAULT true,
    "activoDesde" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partidosSinSlot" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OverrideCanchasDia_torneoId_fkey" FOREIGN KEY ("torneoId") REFERENCES "Torneo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OverrideCanchasDia_torneoId_idx" ON "OverrideCanchasDia"("torneoId");

-- CreateIndex
CREATE UNIQUE INDEX "OverrideCanchasDia_torneoId_diaKey_key" ON "OverrideCanchasDia"("torneoId", "diaKey");
