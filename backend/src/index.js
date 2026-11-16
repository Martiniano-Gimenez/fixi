require('./config/timezone');

const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./config/env');
const errorHandler = require('./middleware/errorHandler');

// Rutas
const authRoutes = require('./routes/auth.routes');
const organizadorRoutes = require('./routes/organizador.routes');
const torneoRoutes = require('./routes/torneo.routes');
const categoriaRoutes = require('./routes/categoria.routes');
const parejaRoutes = require('./routes/pareja.routes');
const partidoRoutes = require('./routes/partido.routes');
const publicRoutes = require('./routes/public.routes');

const app = express();
app.disable('x-powered-by');

// Detrás de un proxy (Render, Railway) req.ip es la IP del proxy salvo que se confíe en él, y el
// límite por IP de la inscripción pública se vuelve uno solo para todos. TRUST_PROXY: un número de
// saltos ("1"), "true" o una lista de subredes, como acepta Express. Sin la variable, no se confía.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
}

// ─── Middlewares globales ────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
const origenesPermitidos = new Set((process.env.CORS_ORIGIN || '').split(',').map((origen) => origen.trim()).filter(Boolean));
app.use(cors({
  origin: (origen, callback) => callback(null, Boolean(origen && origenesPermitidos.has(origen))),
  allowedHeaders: ['Authorization', 'Content-Type'],
}));
app.use(express.json());

// ─── Logging middleware ──────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ─── Health check ────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Rutas de la API ─────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/organizador', organizadorRoutes);
app.use('/api/torneos', torneoRoutes);
app.use('/api/categorias', categoriaRoutes);
app.use('/api/parejas', parejaRoutes);
app.use('/api/partidos', partidoRoutes);
app.use('/api/public', publicRoutes);

// Las rutas de API inexistentes no caen en el frontend ni en el 404 HTML de Express.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

// ─── Serve Frontend in Production ────────────────────────
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '../../frontend/dist');
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '));
    next();
  });
  app.use(express.static(frontendPath));

  app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// ─── Error handler (siempre al final) ────────────────────
app.use(errorHandler);

// ─── Iniciar servidor ────────────────────────────────────
const canchasOverridesService = require('./services/canchasOverrides.service');

async function startServer() {
  try {
    await canchasOverridesService.loadFromDb();
    console.log('✅ Caché de overrides de canchas hidratada desde la base de datos.');
  } catch (err) {
    console.error('❌ Error hidratando caché de overrides de canchas:', err);
    process.exit(1);
  }

  return app.listen(PORT, () => {
    console.log(`🏸 Backend corriendo en http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
