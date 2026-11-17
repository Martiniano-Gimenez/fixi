const { createHash } = require('node:crypto');
const { normalizarEmail } = require('../services/auth.service');

const VENTANA_LOGIN = 15 * 60 * 1000;
const VENTANA_REGISTRO = 60 * 60 * 1000;
const MENSAJE = 'Demasiados intentos. Probá de nuevo en unos minutos.';

function crearLimitesAuth({ ahora = () => Date.now() } = {}) {
  const porEmailIp = new Map(), porIp = new Map(), registros = new Map();

  function limpiarVencidas(t) {
    for (const mapa of [porEmailIp, porIp]) {
      for (const [clave, entrada] of mapa) {
        entrada.fallos = entrada.fallos.filter(fecha => fecha > t - VENTANA_LOGIN);
        if (!entrada.fallos.length && !entrada.enCurso) mapa.delete(clave);
      }
    }
    for (const [ip, intentos] of registros) {
      const vigentes = intentos.filter(fecha => fecha > t - VENTANA_REGISTRO);
      if (vigentes.length) registros.set(ip, vigentes); else registros.delete(ip);
    }
  }

  function bloquear(res, segundos) {
    res.set('Retry-After', String(Math.max(1, Math.ceil(segundos))));
    return res.status(429).json({ error: MENSAJE });
  }

  const nuevaEntrada = () => ({ fallos: [], enCurso: 0 });
  const agotado = (entrada, max) => entrada.fallos.length + entrada.enCurso >= max;
  const espera = (entrada, t) => entrada.enCurso ? 1 : (entrada.fallos[0] + VENTANA_LOGIN - t) / 1000;

  function limitarLogin(req, res, next) {
    const t = ahora();
    limpiarVencidas(t);
    const ip = req.ip || 'desconocida';
    // Clave de tamaño fijo incluso ante un email enorme; la validación sigue en el servicio.
    const email = createHash('sha256').update(normalizarEmail(req.body?.email)).digest('hex');
    const clave = JSON.stringify([ip, email]);
    const pareja = porEmailIp.get(clave) || nuevaEntrada();
    const conexion = porIp.get(ip) || nuevaEntrada();
    const esperas = [];
    if (agotado(pareja, 5)) esperas.push(espera(pareja, t));
    if (agotado(conexion, 30)) esperas.push(espera(conexion, t));
    if (esperas.length) return bloquear(res, Math.max(...esperas));

    // Reservar mientras se compara la contraseña impide saltarse el límite con pedidos paralelos.
    pareja.enCurso++; conexion.enCurso++;
    porEmailIp.set(clave, pareja); porIp.set(ip, conexion);
    let terminado = false;
    function finalizar(abandonado) {
      if (terminado) return;
      terminado = true;
      pareja.enCurso--; conexion.enCurso--;
      if (abandonado || res.statusCode === 401) {
        pareja.fallos.push(ahora()); conexion.fallos.push(ahora());
      } else if (res.statusCode >= 200 && res.statusCode < 300) {
        pareja.fallos = [];
        // Un acierto no borra los fallos globales de la IP contra otras cuentas.
      }
      limpiarVencidas(ahora());
    }
    res.once('finish', () => finalizar(false));
    res.once('close', () => finalizar(true));
    return next();
  }

  function limitarRegistro(req, res, next) {
    const t = ahora();
    limpiarVencidas(t);
    const ip = req.ip || 'desconocida';
    const intentos = registros.get(ip) || [];
    if (intentos.length >= 10) return bloquear(res, (intentos[0] + VENTANA_REGISTRO - t) / 1000);
    intentos.push(t);
    registros.set(ip, intentos);
    return next();
  }

  return {
    limitarLogin,
    limitarRegistro,
    // Como en limitePorIp, permite comprobar que las entradas vencidas se liberan sin temporizadores.
    tamano: () => ({ emailIp: porEmailIp.size, ip: porIp.size, registro: registros.size }),
  };
}

module.exports = { crearLimitesAuth, limitesAuth: crearLimitesAuth() };
