#!/usr/bin/env node
/**
 * actualizar-horarios-parejas.js
 * Actualiza la disponibilidad horaria (slotsSeleccionados) de todas las parejas
 * inscriptas a partir de un archivo Excel, aplicando un margen de minutos (por defecto 30m)
 * antes y después del rango horario declarado por cada pareja.
 *
 * USO:
 *   node scripts/actualizar-horarios-parejas.js [--archivo=ruta.xlsx] [--torneoId=<id>] [--margenMinutos=30]
 */

'use strict';

require('dotenv').config();
const path   = require('path');
const XLSX   = require('xlsx');
const prisma = require('../src/lib/prisma');

// ─── Helpers de tiempo ──────────────────────────────────────────────────────

function horaAMinutos(h, isFin = false) {
  if (h === null || h === undefined) return null;
  let str = String(h).toLowerCase().replace(/hs?|hrs?|horas?/gi, '').trim();
  if (isFin && (str === '00:00' || str === '00' || str === '0' || str === '24:00' || str === '24')) {
    return 24 * 60;
  }
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10) * 60;
  }
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  return null;
}

function minutosAHora(min) {
  const hh = Math.floor(min / 60) % 24;
  const mm = min % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ─── Parser de horarios ─────────────────────────────────────────────────────

const PALABRAS_VIERNES = ['viernes', 'vier', 'vier.', 'vie'];
const PALABRAS_SABADO  = ['sabado', 'sábado', 'sab', 'sab.'];

function detectarDia(texto) {
  const t = texto.toLowerCase();
  if (PALABRAS_VIERNES.some(p => t.includes(p))) return 'Viernes';
  if (PALABRAS_SABADO.some(p => t.includes(p)))  return 'Sabado';
  return null;
}

function parsearRangoHorario(segmento) {
  let s = segmento.replace(/\(.*?\)/g, '').trim().toLowerCase();
  s = s.replace(/,\s*/g, ' ');

  if (/todo\s+el\s+d[ií]a|libre|todo/.test(s)) {
    return { inicioMin: null, finMin: null, todoElDia: true };
  }

  s = s.replace(/despu[eé]s\s+de\s+(?:las?\s+)?/gi, 'desde ');
  s = s.replace(/luego\s+de\s+(?:las?\s+)?/gi, 'desde ');
  s = s.replace(/^\+/, 'desde ');
  s = s.replace(/\s+\+/, ' desde ');
  s = s.replace(/entre\s+(\d{1,2}(?::\d{2})?(?:hs)?)\s+y\s+(\d{1,2}(?::\d{2})?(?:hs)?)/gi, '$1 a $2');
  s = s.replace(/(?:^|\s+)de\s+/gi, ' ');
  s = s.replace(/los\s+dos\s+partidos|los\s+dos|no\s+seguidos|seguidos|medio\s+seguidos|si\s+es\s+posible|cuanto\s+m[aá]s\s+temprano\s+mejor/gi, '').trim();
  s = s.replace(/\s+/g, ' ').trim();

  // "X a Y"
  let m = s.match(/^(\d{1,2}(?::\d{2})?(?:hs)?)\s*a\s*(\d{1,2}(?::\d{2})?(?:hs)?)$/i);
  if (m) {
    return { inicioMin: horaAMinutos(m[1], false), finMin: horaAMinutos(m[2], true), todoElDia: false };
  }

  // "desde X"
  m = s.match(/^desde\s+(?:las?\s+)?(\d{1,2}(?::\d{2})?(?:hs)?)$/i);
  if (m) {
    return { inicioMin: horaAMinutos(m[1], false), finMin: null, todoElDia: false };
  }

  // "hasta Y"
  m = s.match(/^hasta\s+(?:las?\s+)?(\d{1,2}(?::\d{2})?(?:hs)?)$/i);
  if (m) {
    return { inicioMin: null, finMin: horaAMinutos(m[1], true), todoElDia: false };
  }

  // número suelto → "desde X"
  m = s.match(/^(\d{1,2}(?::\d{2})?(?:hs)?)$/i);
  if (m) {
    return { inicioMin: horaAMinutos(m[1], false), finMin: null, todoElDia: false };
  }

  return null;
}

function parsearHorarios(texto) {
  if (!texto || !String(texto).trim()) return null;

  const textoLower = String(texto).toLowerCase();
  const sabadoTambien = textoLower.includes('sábado también') || textoLower.includes('sabado tambien');

  const segmentos = String(texto).split('/').map(s => s.trim()).filter(Boolean);
  const resultados = [];

  for (const seg of segmentos) {
    let sinDia = seg
      .replace(/viernes/gi, '')
      .replace(/sábado/gi, '')
      .replace(/sabado/gi, '')
      .replace(/vier\.?/gi, '')
      .replace(/sab\.?/gi, '')
      .trim();

    const dia = detectarDia(seg);
    const rango = parsearRangoHorario(sinDia || seg);

    if (!rango) {
      return { error: `Segmento no reconocido: "${seg}"` };
    }

    if (dia) {
      resultados.push({ dia, ...rango });
      if (sabadoTambien && dia === 'Viernes') {
        resultados.push({ dia: 'Sabado', ...rango });
      }
    } else {
      resultados.push({ dia: 'Viernes', ...rango });
      resultados.push({ dia: 'Sabado',  ...rango });
    }
  }

  if (resultados.length === 0) return null;
  return resultados;
}

// ─── Cálculo de slots ───────────────────────────────────────────────────────

function calcularSlots(organizador, rangos, margenMinutos = 30) {
  const DURACION = 75;      // minutos por partido
  const GRANULARIDAD = 15;  // minutos por step en la grilla

  function getSlotsConTiempos(dia, horaInicio, horaFin) {
    if (!horaInicio || !horaFin) return { slots: [], aperturaMin: 0, cierreMin: 0 };
    const inicioMin = horaAMinutos(horaInicio);
    let finMin = horaAMinutos(horaFin);
    if (finMin < inicioMin) {
      finMin += 24 * 60;
    }
    const slots = [];
    for (let m = inicioMin; m + DURACION <= finMin; m += GRANULARIDAD) {
      const clockMin = m % (24 * 60);
      slots.push({
        slotId: `${dia}-${minutosAHora(clockMin)}`,
        startMin: m,
        endMin: m + DURACION,
      });
    }
    return { slots, aperturaMin: inicioMin, cierreMin: finMin };
  }

  const grillaViernes = getSlotsConTiempos('Viernes', organizador.viernesInicio, organizador.viernesFin);
  const grillaSabado  = getSlotsConTiempos('Sabado',  organizador.sabadoInicio,  organizador.sabadoFin);

  const grillasPorDia = {
    Viernes: grillaViernes,
    Sabado:  grillaSabado,
  };

  const slotsResultado = new Set();

  for (const rango of rangos) {
    const { slots, aperturaMin, cierreMin } = grillasPorDia[rango.dia] || { slots: [], aperturaMin: 0, cierreMin: 0 };

    for (const slot of slots) {
      if (rango.todoElDia) {
        slotsResultado.add(slot.slotId);
        continue;
      }

      // Aplicar margen antes (inicioMin - margen) acotado por apertura del club
      let inicio = aperturaMin;
      if (rango.inicioMin !== null) {
        inicio = Math.max(aperturaMin, rango.inicioMin - margenMinutos);
      }

      // Aplicar margen después (finMin + margen) acotado por cierre del club
      let fin = cierreMin;
      if (rango.finMin !== null) {
        let rFin = rango.finMin;
        if (rango.inicioMin !== null && rFin < rango.inicioMin) {
          rFin += 24 * 60;
        }
        fin = Math.min(cierreMin, rFin + margenMinutos);
      }

      if (slot.startMin >= inicio && slot.endMin <= fin) {
        slotsResultado.add(slot.slotId);
      }
    }
  }

  return [...slotsResultado];
}

// ─── Argparse ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const archivoPath   = path.resolve(args.archivo || path.resolve(__dirname, '../../Inscripciones_Padel_Ordenado.xlsx'));
  const margenMinutos = args.margenMinutos !== undefined ? parseInt(args.margenMinutos, 10) : 30;

  console.log('🎾 ACTUALIZADOR DE HORARIOS DE PAREJAS');
  console.log('═'.repeat(60));
  console.log(`  Archivo: ${archivoPath}`);
  console.log(`  Margen : ±${margenMinutos} minutos antes y después`);

  // 1. Leer XLSX
  let workbook;
  try {
    workbook = XLSX.readFile(archivoPath);
  } catch (e) {
    console.error(`❌ No se pudo leer el archivo: ${archivoPath}\n   ${e.message}`);
    process.exit(1);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet     = workbook.Sheets[sheetName];
  const filas     = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const filasDatos = filas.slice(1);

  console.log(`  Total filas en Excel: ${filasDatos.length}`);

  // 2. Buscar torneo
  let torneo;
  if (args.torneoId) {
    torneo = await prisma.torneo.findUnique({
      where: { id: args.torneoId },
      include: {
        categorias: {
          include: {
            parejas: {
              include: { slotsSeleccionados: true },
              orderBy: { orden: 'asc' },
            },
          },
        },
        organizador: true,
      },
    });
  } else {
    // Buscar el torneo principal que contenga las parejas
    torneo = await prisma.torneo.findFirst({
      where: {
        nombre: { contains: 'Agosto' },
      },
      include: {
        categorias: {
          include: {
            parejas: {
              include: { slotsSeleccionados: true },
              orderBy: { orden: 'asc' },
            },
          },
        },
        organizador: true,
      },
    });
  }

  if (!torneo) {
    console.error('❌ Torneo no encontrado en la base de datos.');
    process.exit(1);
  }

  // Guard de ciclo de vida: la disponibilidad horaria solo se puede actualizar para categorías en BORRADOR
  const categoriasBorrador = torneo.categorias.filter((c) => c.estado === 'BORRADOR');
  if (categoriasBorrador.length === 0) {
    console.error(`❌ No se puede actualizar disponibilidad: todas las categorías del torneo ya fueron iniciadas (disponibilidad congelada).`);
    process.exit(1);
  }

  console.log(`  Torneo: "${torneo.nombre}" (ID: ${torneo.id})`);
  console.log(`  Club: ${torneo.organizador.nombre}`);
  console.log(`  Grilla Viernes: ${torneo.organizador.viernesInicio} a ${torneo.organizador.viernesFin}`);
  console.log(`  Grilla Sábado : ${torneo.organizador.sabadoInicio} a ${torneo.organizador.sabadoFin}`);
  console.log('═'.repeat(60) + '\n');

  // Mapear categorías
  const catMap = new Map();
  for (const c of torneo.categorias) {
    catMap.set(c.nombre.toLowerCase().trim(), c.parejas);
  }

  const currentIndices = {};
  for (const c of torneo.categorias) {
    currentIndices[c.nombre.toLowerCase().trim()] = 0;
  }

  let totalActualizadas = 0;
  let totalSinCambios = 0;

  for (let i = 0; i < filasDatos.length; i++) {
    const fila = filasDatos[i];
    const numFila = i + 2;
    const apellido1 = String(fila[0] || '').trim();
    const apellido2 = String(fila[1] || '').trim();
    const catNombre = String(fila[2] || '').trim();
    const horariosRaw = String(fila[3] || '').trim();

    const catKey = catNombre.toLowerCase();
    const categoria = torneo.categorias.find((c) => c.nombre.toLowerCase().trim() === catKey);
    if (!categoria) {
      console.warn(`⚠️ Fila ${numFila}: Categoría no encontrada "${catNombre}"`);
      continue;
    }

    if (categoria.estado !== 'BORRADOR') {
      console.warn(`⚠️ Fila ${numFila}: La categoría "${categoria.nombre}" ya inició (${categoria.estado}). Disponibilidad congelada (se omite).`);
      continue;
    }

    const pList = catMap.get(catKey);
    if (!pList) {
      console.warn(`⚠️ Fila ${numFila}: No se encontraron parejas para la categoría "${catNombre}"`);
      continue;
    }

    const idx = currentIndices[catKey]++;
    const pareja = pList[idx];

    if (!pareja) {
      console.warn(`⚠️ Fila ${numFila}: No hay pareja en DB para índice ${idx} (${apellido1} / ${apellido2})`);
      continue;
    }

    const parseResult = parsearHorarios(horariosRaw);
    if (!parseResult || parseResult.error) {
      console.error(`❌ Fila ${numFila}: Error al parsear "${horariosRaw}" -> ${parseResult?.error}`);
      continue;
    }

    const nuevosSlots = calcularSlots(torneo.organizador, parseResult, margenMinutos);
    const slotsActuales = pareja.slotsSeleccionados.map(s => s.slotId);

    // Comparar slots
    const setActual = new Set(slotsActuales);
    const setNuevo = new Set(nuevosSlots);
    const sonIguales = setActual.size === setNuevo.size && [...setNuevo].every(s => setActual.has(s));

    // Actualizar en DB
    await prisma.$transaction(async (tx) => {
      await tx.pareja.update({
        where: { id: pareja.id },
        data: { resolucionManual: false },
      });

      await tx.slotPareja.deleteMany({
        where: { parejaId: pareja.id },
      });

      if (nuevosSlots.length > 0) {
        await tx.slotPareja.createMany({
          data: nuevosSlots.map(slotId => ({
            parejaId: pareja.id,
            slotId,
          })),
        });
      }
    });

    if (sonIguales) {
      totalSinCambios++;
      console.log(`ℹ️ [${catNombre}] ${pareja.jugador1} / ${pareja.jugador2} — Sin cambios (${nuevosSlots.length} slots)`);
    } else {
      totalActualizadas++;
      console.log(`✅ [${catNombre}] ${pareja.jugador1} / ${pareja.jugador2} — Actualizada: ${slotsActuales.length} -> ${nuevosSlots.length} slots ("${horariosRaw}")`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  RESUMEN DE ACTUALIZACIÓN');
  console.log('═'.repeat(60));
  console.log(`  Total parejas procesadas : ${filasDatos.length}`);
  console.log(`  Parejas actualizadas     : ${totalActualizadas}`);
  console.log(`  Parejas sin modificaciones: ${totalSinCambios}`);
  console.log('═'.repeat(60) + '\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('❌ Error fatal:', e);
  await prisma.$disconnect();
  process.exit(1);
});
