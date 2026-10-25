'use strict';

const { horaAMinutos } = require('../services/slots.service');

/**
 * Ventana de los dieciseisavos (R32) del sábado a la noche.
 * Única fuente del cálculo: la usan programarHorariosEliminatorias y el Modo Lluvia de sábado.
 *
 * - Inicio: max(apertura del sábado, min(20:45, cierre efectivo - 150 min)).
 * - Fin: cierre efectivo del sábado (si el cierre es <= apertura, se toma como trasnoche del día siguiente).
 *
 * @param {object} organizador - Club con sabadoInicio / sabadoFin ("HH:MM")
 * @param {number} baseSaturdayMs - Medianoche local del sábado del torneo (ms)
 * @returns {{ sabNightStartMs: number, sabNightEndMs: number }}
 */
function calcularVentanaSabadoNoche(organizador, baseSaturdayMs) {
  const sabInicioMin = horaAMinutos(organizador.sabadoInicio || '08:00');
  const sabFinMin = horaAMinutos(organizador.sabadoFin || '23:00');
  const sabEffectiveFinMin = sabFinMin <= sabInicioMin ? sabFinMin + 24 * 60 : sabFinMin;
  const sabNightStartMin = Math.max(sabInicioMin, Math.min(20 * 60 + 45, sabEffectiveFinMin - 150));
  return {
    sabNightStartMs: baseSaturdayMs + sabNightStartMin * 60 * 1000,
    sabNightEndMs: baseSaturdayMs + sabEffectiveFinMin * 60 * 1000,
  };
}

module.exports = { calcularVentanaSabadoNoche };
