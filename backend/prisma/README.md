# Flujo de Migraciones de Base de Datos - Fixi

## Reglas Obligatorias

1. **Uso exclusivo de `prisma migrate dev`**:
   - De ahora en más, todo cambio de esquema en `schema.prisma` debe versionarse ejecutando:
     ```bash
     npx prisma migrate dev --name <descripcion_del_cambio>
     ```
   - **NUNCA ejecutar `npx prisma db push`** en entornos de desarrollo ni producción, ya que rompe la tabla de historial `_prisma_migrations` y genera drift.

2. **Diferencias entre SQLite y PostgreSQL**:
   - Las migraciones contenidas en `prisma/migrations/` están generadas con sintaxis SQL específica para **SQLite** (entorno de desarrollo local).
   - Para el despliegue en producción sobre **PostgreSQL** (en Render, Railway, Neon o Supabase):
     - El historial de migraciones de SQLite no se debe aplicar directamente sobre Postgres.
     - Se debe inicializar la base de datos de producción generando la línea base inicial para PostgreSQL:
       ```bash
       npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_init_postgres/migration.sql
       ```
     - O bien baselining en producción con `prisma migrate resolve` / `prisma migrate deploy`.

3. **Copia de seguridad previa**:
   - Antes de aplicar cambios estructurales en desarrollo, siempre realizar un backup de `dev.db`.

4. **Base de Datos de Test y Plantilla (`test.template.db` / `test.db`)**:
   - Las pruebas automatizadas corren exclusivamente contra `prisma/test.db`, garantizando aislamiento total de `dev.db`.
   - Antes de cada suite, `scripts/reset-test-db.js` restablece `test.db` como copia limpia de `test.template.db`.
   - **Regeneración de la plantilla**:
     - Si `test.template.db` no existe, `reset-test-db.js` la regenera automáticamente ejecutando `prisma migrate deploy` sobre una base SQLite temporal y copiándola luego atómicamente a `test.template.db`.
     - Después de las migraciones aplica las guardas de `scripts/utils/test-db-guards.sql` (por ejemplo, el trigger que rechaza parejas con `orden` repetido en la categoría). Si cambia ese archivo, la plantilla se regenera sola: el marcador `prisma/test.template.guards` guarda el SHA256 del SQL aplicado.
     - Si se modificó el esquema (`schema.prisma`) y se crearon nuevas migraciones, podés regenerar la plantilla ejecutando:
       ```bash
       npm run test:db:reset -- --rebuild-template
       ```
       o eliminando `prisma/test.template.db` (se autogenerará en la próxima ejecución de tests).
