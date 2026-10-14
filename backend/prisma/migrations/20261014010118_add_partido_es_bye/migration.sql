-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Partido" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoriaId" TEXT NOT NULL,
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
    "esBye" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Partido_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Partido_zonaId_fkey" FOREIGN KEY ("zonaId") REFERENCES "Zona" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_faseEliminatoriaId_fkey" FOREIGN KEY ("faseEliminatoriaId") REFERENCES "FaseEliminatoria" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_pareja1Id_fkey" FOREIGN KEY ("pareja1Id") REFERENCES "Pareja" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_pareja2Id_fkey" FOREIGN KEY ("pareja2Id") REFERENCES "Pareja" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_ganadorId_fkey" FOREIGN KEY ("ganadorId") REFERENCES "Pareja" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Partido" ("canchaNumero", "categoriaId", "estado", "faseEliminatoriaId", "fechaHora", "ganadorId", "id", "origenPareja1", "origenPareja2", "pareja1Id", "pareja2Id", "posicionEnRonda", "sinHorarioAsignado", "zonaId") SELECT "canchaNumero", "categoriaId", "estado", "faseEliminatoriaId", "fechaHora", "ganadorId", "id", "origenPareja1", "origenPareja2", "pareja1Id", "pareja2Id", "posicionEnRonda", "sinHorarioAsignado", "zonaId" FROM "Partido";
DROP TABLE "Partido";
ALTER TABLE "new_Partido" RENAME TO "Partido";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
