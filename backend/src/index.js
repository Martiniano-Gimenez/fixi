const express = require('express');
const cors = require('cors');
const { PORT } = require('./config/env');
const errorHandler = require('./middleware/errorHandler');

// Rutas
const authRoutes = require('./routes/auth.routes');
const torneoRoutes = require('./routes/torneo.routes');
const parejaRoutes = require('./routes/pareja.routes');
const partidoRoutes = require('./routes/partido.routes');
const publicRoutes = require('./routes/public.routes');

const app = express();

// ─── Middlewares globales ────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Health check ────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Rutas de la API ─────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/torneos', torneoRoutes);
app.use('/api/parejas', parejaRoutes);
app.use('/api/partidos', partidoRoutes);
app.use('/api/public', publicRoutes);

// ─── Error handler (siempre al final) ────────────────────
app.use(errorHandler);

// ─── Iniciar servidor ────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🏸 Backend corriendo en http://localhost:${PORT}`);
});
