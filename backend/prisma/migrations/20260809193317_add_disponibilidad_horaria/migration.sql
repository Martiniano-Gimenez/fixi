-- CreateTable
CREATE TABLE "DisponibilidadPareja" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parejaId" TEXT NOT NULL,
    "dia" TEXT NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    CONSTRAINT "DisponibilidadPareja_parejaId_fkey" FOREIGN KEY ("parejaId") REFERENCES "Pareja" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Partido" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "torneoId" TEXT NOT NULL,
    "zonaId" TEXT,
    "faseEliminatoriaId" TEXT,
    "posicionEnRonda" INTEGER NOT NULL DEFAULT 1,
    "pareja1Id" TEXT,
    "origenPareja1" TEXT,
    "pareja2Id" TEXT,
    "origenPareja2" TEXT,
    "ganadorId" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "fechaHora" DATETIME,
    "canchaNumero" INTEGER,
    "sinHorarioAsignado" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Partido_torneoId_fkey" FOREIGN KEY ("torneoId") REFERENCES "Torneo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Partido_zonaId_fkey" FOREIGN KEY ("zonaId") REFERENCES "Zona" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_faseEliminatoriaId_fkey" FOREIGN KEY ("faseEliminatoriaId") REFERENCES "FaseEliminatoria" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_pareja1Id_fkey" FOREIGN KEY ("pareja1Id") REFERENCES "Pareja" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_pareja2Id_fkey" FOREIGN KEY ("pareja2Id") REFERENCES "Pareja" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_ganadorId_fkey" FOREIGN KEY ("ganadorId") REFERENCES "Pareja" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Partido" ("estado", "faseEliminatoriaId", "fechaHora", "ganadorId", "id", "pareja1Id", "pareja2Id", "posicionEnRonda", "torneoId", "zonaId") SELECT "estado", "faseEliminatoriaId", "fechaHora", "ganadorId", "id", "pareja1Id", "pareja2Id", "posicionEnRonda", "torneoId", "zonaId" FROM "Partido";
DROP TABLE "Partido";
ALTER TABLE "new_Partido" RENAME TO "Partido";
CREATE TABLE "new_Torneo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizadorId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "fecha" DATETIME,
    "slug" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "cantidadCanchas" INTEGER NOT NULL DEFAULT 1,
    "duracionPartidoMin" INTEGER NOT NULL DEFAULT 75,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Torneo_organizadorId_fkey" FOREIGN KEY ("organizadorId") REFERENCES "Organizador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Torneo" ("createdAt", "estado", "fecha", "id", "nombre", "organizadorId", "slug", "updatedAt") SELECT "createdAt", "estado", "fecha", "id", "nombre", "organizadorId", "slug", "updatedAt" FROM "Torneo";
DROP TABLE "Torneo";
ALTER TABLE "new_Torneo" RENAME TO "Torneo";
CREATE UNIQUE INDEX "Torneo_slug_key" ON "Torneo"("slug");
CREATE TABLE "new_Zona" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "torneoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "clasifican" INTEGER NOT NULL DEFAULT 2,
    "formato" TEXT NOT NULL DEFAULT 'ROUND_ROBIN',
    "requiereArmadoManual" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Zona_torneoId_fkey" FOREIGN KEY ("torneoId") REFERENCES "Torneo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Zona" ("clasifican", "formato", "id", "nombre", "torneoId") SELECT "clasifican", "formato", "id", "nombre", "torneoId" FROM "Zona";
DROP TABLE "Zona";
ALTER TABLE "new_Zona" RENAME TO "Zona";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
