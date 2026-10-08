# Backend - Fixi Padel Torneos

API backend en Node.js / Express con Prisma ORM y base de datos SQLite (desarrollo/test) y PostgreSQL (producción).

---

## 🕒 Requisito Crítico: Zona Horaria y `tzdata`

El backend y toda la lógica de scheduling (slots de partidos, trasnoche, cálculo de jornadas lógicas y límites de día) operan bajo la zona horaria civil de Argentina:
* **Timezone IANA:** `America/Argentina/Buenos_Aires` (UTC-3, sin horario de verano).
* **Offset:** -180 minutos (-03:00).

### Blindaje de Arranque (`backend/src/config/timezone.js`)
Al inicializarse el servidor (`src/index.js`), las suites de prueba (`scripts/utils/testEnvGuard.js`) o las herramientas de desarrollo (`scripts/dev-tools/devUtils.js`):
1. Se asigna automáticamente `process.env.TZ = 'America/Argentina/Buenos_Aires'`.
2. Se ejecuta una comprobación inmediata de offset: `new Date(2026, 0, 1, 12).getTimezoneOffset() === 180`.
3. Si el entorno no soporta la zona horaria, el proceso aborta inmediatamente con un error descriptivo:
   ```text
   Error: zona horaria no soportada en este entorno: instalar tzdata o usar una imagen con ICU completo
   ```

### Consideraciones para Despliegue y Hosting (Docker / Cloud)
* **Imágenes basadas en Debian / Ubuntu:** Las imágenes estándar de Node.js (`node:20`, `node:22`, `node:lts`) ya incluyen soporte completo de IANA / ICU y son directamente compatibles.
* **Imágenes Alpine Linux (`node:alpine`):** Si se utiliza Alpine en Docker, es **obligatorio** instalar los paquetes de zona horaria y datos ICU en el `Dockerfile`:
  ```dockerfile
  RUN apk add --no-cache tzdata icu-data-full
  ```
* En servicios tipo PaaS (Render, Railway, Fly.io, etc.), el proceso forzará automáticamente `TZ=America/Argentina/Buenos_Aires` desde `src/config/timezone.js`.

---

## 🧪 Pruebas Automatizadas

```bash
# Ejecutar la suite completa (20 suites con base aislada test.db)
npm test

# Resetear base de test desde plantilla
npm run test:db:reset
```
