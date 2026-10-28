/**
 * Límite de pedidos por IP con ventana fija, en memoria (un contador por instancia del servidor).
 *
 * - IPv4 (y la IPv4 mapeada en IPv6, "::ffff:a.b.c.d"): la clave es la dirección.
 * - IPv6: la clave es el prefijo /64, que suele ser lo que recibe un mismo cliente.
 * - Las entradas vencidas se borran como mucho una vez por ventana, para que el Map no crezca sin tope.
 * - `max` y `ventanaMs` pueden ser funciones: se leen en cada pedido (los tests los cambian por env).
 *
 * Detrás de un proxy (Render, Railway) `req.ip` es la IP del proxy salvo que se configure
 * TRUST_PROXY (ver src/index.js); sin eso, todos los clientes comparten un solo contador.
 */

function expandirIPv6(ip) {
  const [cabeza, cola] = ip.split('::');
  const partes = (s) => (s ? s.split(':') : []);
  const izq = partes(cabeza);
  const der = cola === undefined ? [] : partes(cola);
  const faltan = cola === undefined ? 0 : 8 - izq.length - der.length;
  return [...izq, ...Array(Math.max(0, faltan)).fill('0'), ...der].map((h) => parseInt(h || '0', 16));
}

function claveIp(ipCruda) {
  const ip = String(ipCruda || '').split('%')[0].toLowerCase();
  const mapeada = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapeada) return mapeada[1];
  if (!ip.includes(':')) return ip || 'desconocida';
  const hextetos = expandirIPv6(ip);
  return `${hextetos.slice(0, 4).map((h) => h.toString(16)).join(':')}::/64`;
}

const valor = (v) => (typeof v === 'function' ? v() : v);

function crearLimitePorIp({ ventanaMs, max, ahora = Date.now, codigo = 'LIMITE', mensaje }) {
  const entradas = new Map(); // clave -> { inicio, cuenta }
  let ultimaLimpieza = 0;

  function limpiarVencidas(t, ventana) {
    for (const [clave, e] of entradas) {
      if (t - e.inicio >= ventana) entradas.delete(clave);
    }
    ultimaLimpieza = t;
  }

  function middleware(req, res, next) {
    const t = ahora();
    const ventana = valor(ventanaMs);
    const tope = valor(max);
    if (t - ultimaLimpieza >= ventana) limpiarVencidas(t, ventana);

    const clave = claveIp(req.ip);
    let e = entradas.get(clave);
    if (!e || t - e.inicio >= ventana) {
      e = { inicio: t, cuenta: 0 };
      entradas.set(clave, e);
    }
    e.cuenta += 1;
    if (e.cuenta > tope) {
      return res.status(429).json({
        error: mensaje || 'Demasiados intentos desde esta conexión. Probá de nuevo en unos minutos.',
        codigo,
      });
    }
    return next();
  }

  middleware.reset = () => {
    entradas.clear();
    ultimaLimpieza = 0;
  };
  middleware.tamano = () => entradas.size;
  return middleware;
}

const QUINCE_MIN = 15 * 60 * 1000;

// POST /api/public/:slug/inscripcion. Tope alto a propósito: mucha gente comparte IP (CGNAT de
// los celulares, WiFi del club).
const limiteInscripcion = crearLimitePorIp({
  ventanaMs: () => Number(process.env.INSCRIPCION_VENTANA_MS) || QUINCE_MIN,
  max: () => Number(process.env.INSCRIPCION_MAX_POR_VENTANA) || 20,
});

module.exports = { crearLimitePorIp, claveIp, limiteInscripcion };
