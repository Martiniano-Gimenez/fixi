-- Guardas que se aplican SOLO a test.template.db (y por copia a test.db), nunca a dev.db.
-- reset-test-db.js las aplica después de 'prisma migrate deploy' y regenera la plantilla
-- cuando cambia el contenido de este archivo.

-- pareja.orden debe ser único dentro de la categoría: el scheduler ordena por (orden, id)
-- y un orden repetido deja el desempate en manos del UUID, que cambia entre corridas.
-- Prisma informa este RAISE(ABORT) como P2003 (SQLITE_CONSTRAINT), no con el mensaje.
CREATE TRIGGER IF NOT EXISTS trg_test_pareja_orden_unico
BEFORE INSERT ON "Pareja"
WHEN EXISTS (SELECT 1 FROM "Pareja" WHERE "categoriaId" = NEW."categoriaId" AND "orden" = NEW."orden")
BEGIN
  SELECT RAISE(ABORT, 'ORDEN_DUPLICADO: pareja.orden repetido en la categoria');
END;
