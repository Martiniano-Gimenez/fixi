-- CreateTable
CREATE TABLE "Organizador" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cantidadCanchas" INTEGER NOT NULL DEFAULT 1,
    "viernesInicio" TEXT,
    "viernesFin" TEXT,
    "sabadoInicio" TEXT,
    "sabadoFin" TEXT,
    "domingoInicio" TEXT,
    "domingoFin" TEXT
);

-- CreateTable
CREATE TABLE "Torneo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizadorId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "fecha" DATETIME,
    "slug" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "canchasDisponiblesOverride" INTEGER,
    "overrideActivoDesde" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Torneo_organizadorId_fkey" FOREIGN KEY ("organizadorId") REFERENCES "Organizador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "torneoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Categoria_torneoId_fkey" FOREIGN KEY ("torneoId") REFERENCES "Torneo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pareja" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoriaId" TEXT NOT NULL,
    "jugador1" TEXT NOT NULL,
    "jugador2" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "resolucionManual" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Pareja_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlotPareja" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parejaId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    CONSTRAINT "SlotPareja_parejaId_fkey" FOREIGN KEY ("parejaId") REFERENCES "Pareja" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Zona" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoriaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "clasifican" INTEGER NOT NULL DEFAULT 2,
    "formato" TEXT NOT NULL DEFAULT 'ROUND_ROBIN',
    "requiereArmadoManual" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Zona_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ZonaPareja" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zonaId" TEXT NOT NULL,
    "parejaId" TEXT NOT NULL,
    "posicion" INTEGER NOT NULL DEFAULT 0,
    "pj" INTEGER NOT NULL DEFAULT 0,
    "pg" INTEGER NOT NULL DEFAULT 0,
    "pp" INTEGER NOT NULL DEFAULT 0,
    "sf" INTEGER NOT NULL DEFAULT 0,
    "sc" INTEGER NOT NULL DEFAULT 0,
    "gf" INTEGER NOT NULL DEFAULT 0,
    "gc" INTEGER NOT NULL DEFAULT 0,
    "puntos" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ZonaPareja_zonaId_fkey" FOREIGN KEY ("zonaId") REFERENCES "Zona" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ZonaPareja_parejaId_fkey" FOREIGN KEY ("parejaId") REFERENCES "Pareja" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FaseEliminatoria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoriaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "ronda" INTEGER NOT NULL,
    CONSTRAINT "FaseEliminatoria_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Partido" (
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
    CONSTRAINT "Partido_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Partido_zonaId_fkey" FOREIGN KEY ("zonaId") REFERENCES "Zona" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_faseEliminatoriaId_fkey" FOREIGN KEY ("faseEliminatoriaId") REFERENCES "FaseEliminatoria" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_pareja1Id_fkey" FOREIGN KEY ("pareja1Id") REFERENCES "Pareja" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_pareja2Id_fkey" FOREIGN KEY ("pareja2Id") REFERENCES "Pareja" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partido_ganadorId_fkey" FOREIGN KEY ("ganadorId") REFERENCES "Pareja" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SetPartido" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partidoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "gamesPareja1" INTEGER NOT NULL,
    "gamesPareja2" INTEGER NOT NULL,
    CONSTRAINT "SetPartido_partidoId_fkey" FOREIGN KEY ("partidoId") REFERENCES "Partido" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Organizador_email_key" ON "Organizador"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Torneo_slug_key" ON "Torneo"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SlotPareja_parejaId_slotId_key" ON "SlotPareja"("parejaId", "slotId");

-- CreateIndex
CREATE UNIQUE INDEX "ZonaPareja_zonaId_parejaId_key" ON "ZonaPareja"("zonaId", "parejaId");

-- CreateIndex
CREATE UNIQUE INDEX "SetPartido_partidoId_numero_key" ON "SetPartido"("partidoId", "numero");

