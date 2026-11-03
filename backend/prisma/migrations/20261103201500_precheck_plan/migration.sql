CREATE TABLE "PrecheckPlan" (
    "torneoId" TEXT NOT NULL PRIMARY KEY,
    "contenido" JSONB NOT NULL,
    "revision" TEXT NOT NULL,
    "firma" TEXT NOT NULL,
    "nomina" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PrecheckPlan_torneoId_fkey" FOREIGN KEY ("torneoId") REFERENCES "Torneo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
