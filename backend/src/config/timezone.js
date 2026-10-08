'use strict';

/**
 * timezone.js
 * Configuración y blindaje de la zona horaria del proceso Node.js.
 * Fija 'America/Argentina/Buenos_Aires' (UTC-3, sin horario de verano)
 * y valida inmediatamente que el entorno soporte tzdata / ICU.
 */

process.env.TZ = 'America/Argentina/Buenos_Aires';

const testDate = new Date(2026, 0, 1, 12);
if (testDate.getTimezoneOffset() !== 180) {
  throw new Error(
    'zona horaria no soportada en este entorno: instalar tzdata o usar una imagen con ICU completo'
  );
}

module.exports = {
  TIMEZONE: 'America/Argentina/Buenos_Aires',
  OFFSET_MINUTES: 180,
};
