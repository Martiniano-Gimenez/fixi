'use strict';

const { horaAMinutos } = require('../services/slots.service');
const { calcularFinJornadaMs } = require('./horarioClub');

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
  const sabInicioStr = organizador.sabadoInicio || '08:00';
  const sabFinStr = organizador.sabadoFin || '23:00';
  const sabInicioMin = horaAMinutos(sabInicioStr);
  // Cierre del sábado con la misma fuente que la marca "después del cierre" (horarioClub.js)
  const sabNightEndMs = calcularFinJornadaMs(baseSaturdayMs, sabInicioStr, sabFinStr);
  const sabEffectiveFinMin = (sabNightEndMs - baseSaturdayMs) / (60 * 1000);
  const sabNightStartMin = Math.max(sabInicioMin, Math.min(20 * 60 + 45, sabEffectiveFinMin - 150));
  return {
    sabNightStartMs: baseSaturdayMs + sabNightStartMin * 60 * 1000,
    sabNightEndMs,
  };
}

module.exports = { calcularVentanaSabadoNoche };
