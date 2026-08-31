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

// ─── Middlewares globales ────────────────────────────────
app.use(cors());
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

// ─── Serve Frontend in Production ────────────────────────
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendPath));

  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// ─── Error handler (siempre al final) ────────────────────
app.use(errorHandler);

const { isDebugNowActive, getAhora } = require('./utils/dateUtils');

// ─── Iniciar servidor ────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🏸 Backend corriendo en http://localhost:${PORT}`);
  if (isDebugNowActive()) {
    console.log('\x1b[43m\x1b[30m%s\x1b[0m', '                                                                 ');
    console.log('\x1b[43m\x1b[30m%s\x1b[0m', ` ⚠️  [DEBUG_NOW ACTIVO] Simulando fecha/hora: ${getAhora().toISOString()} `);
    console.log('\x1b[43m\x1b[30m%s\x1b[0m', `     (Definida en .env como "${process.env.DEBUG_NOW}")                   `);
    console.log('\x1b[43m\x1b[30m%s\x1b[0m', '                                                                 ');
  }
});
