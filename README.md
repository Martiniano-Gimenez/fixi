# Fixi

Aplicación web para el seguimiento en tiempo real de torneos de pádel amateur.

## Problema que resuelve

En San Francisco, Córdoba, los organizadores de torneos de pádel amateur llevan
todo en papel (resultados, cuadros, tablas de posiciones). No existe ninguna
solución digital local para esto.

## Usuarios

- **Organizador**: carga resultados y arma el torneo desde un panel con login.
- **Público** (jugadores/espectadores): ve resultados y posiciones en tiempo
  real desde un link, sin necesidad de cuenta.

## Alcance del MVP

- [ ] Crear torneo (eliminación directa, liga, o ambos)
- [ ] Cargar parejas/jugadores
- [ ] Cargar resultados de partidos
- [ ] Tabla de posiciones o cuadro actualizado automáticamente
- [ ] Vista pública en tiempo real (polling simple)
- [ ] Deploy gratis/barato para probar con club piloto

## Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **Base de datos**: PostgreSQL + Prisma

## Estructura del proyecto
padel-torneos/
├── backend/
├── frontend/
├── .gitignore
└── README.md

## Cómo correrlo localmente

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Deploy

- **Frontend**: Vercel / Netlify
- **Backend**: Render / Railway
- **DB**: Supabase / Neon / SQL Server

### Variables de entorno en producción (Backend)

En entornos de producción es obligatorio configurar:
1. `NODE_ENV=production`
2. `JWT_SECRET`: debe ser una clave secreta propia, robusta y con una longitud mínima de 32 caracteres. El backend cuenta con un guardián de arranque que abortará el proceso si se utiliza el valor por defecto o si la clave tiene menos de 32 caracteres.

Podés generar un secreto criptográficamente seguro ejecutando:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
o bien con OpenSSL:
```bash
openssl rand -hex 32
```