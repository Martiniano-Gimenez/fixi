-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Pareja" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoriaId" TEXT NOT NULL,
    "jugador1" TEXT NOT NULL,
    "jugador2" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "resolucionManual" BOOLEAN NOT NULL DEFAULT false,
    "telefono" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'ORGANIZADOR',
    CONSTRAINT "Pareja_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Pareja" ("categoriaId", "id", "jugador1", "jugador2", "orden", "resolucionManual") SELECT "categoriaId", "id", "jugador1", "jugador2", "orden", "resolucionManual" FROM "Pareja";
DROP TABLE "Pareja";
ALTER TABLE "new_Pareja" RENAME TO "Pareja";
CREATE UNIQUE INDEX "Pareja_categoriaId_orden_key" ON "Pareja"("categoriaId", "orden");
CREATE TABLE "new_Torneo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizadorId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "fecha" DATETIME,
    "slug" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "canchasDisponiblesOverride" INTEGER,
    "overrideActivoDesde" DATETIME,
    "inscripcionAbierta" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Torneo_organizadorId_fkey" FOREIGN KEY ("organizadorId") REFERENCES "Organizador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Torneo" ("canchasDisponiblesOverride", "createdAt", "estado", "fecha", "id", "nombre", "organizadorId", "overrideActivoDesde", "slug", "updatedAt") SELECT "canchasDisponiblesOverride", "createdAt", "estado", "fecha", "id", "nombre", "organizadorId", "overrideActivoDesde", "slug", "updatedAt" FROM "Torneo";
DROP TABLE "Torneo";
ALTER TABLE "new_Torneo" RENAME TO "Torneo";
CREATE UNIQUE INDEX "Torneo_slug_key" ON "Torneo"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

