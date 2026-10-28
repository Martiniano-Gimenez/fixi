-- Guardas que se aplican SOLO a test.template.db (y por copia a test.db), nunca a dev.db.
-- reset-test-db.js las aplica después de 'prisma migrate deploy' y regenera la plantilla
-- cuando cambia el contenido de este archivo. Si no hay sentencias, no ejecuta nada.

-- Hoy no hay guardas. La unicidad de pareja.orden en la categoría, que antes vigilaba acá el
-- trigger trg_test_pareja_orden_unico (solo INSERT y solo en test), es desde la sesión 88 la
-- restricción @@unique([categoriaId, orden]) del schema: cubre INSERT y UPDATE en todas las
-- bases y Prisma la informa como P2002.
