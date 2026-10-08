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
