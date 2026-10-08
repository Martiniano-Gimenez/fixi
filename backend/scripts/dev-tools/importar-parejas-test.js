#!/usr/bin/env node
/**
 * importar-parejas-test.js
 * Script de un solo uso para cargar datos de prueba desde un XLSX a la DB.
 *
 * USO:
 *   node scripts/dev-tools/importar-parejas-test.js --confirmar-dev --archivo=ruta.xlsx --torneoId=<id> [--margenMinutos=60]
 */

'use strict';

require('dotenv').config();
const path   = require('path');
const XLSX   = require('xlsx');
const prisma = require('../../src/lib/prisma');
const { requireConfirmarDev, crearBackupDevDb } = require('./devUtils');

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

  let m = s.match(/^(\d{1,2}(?::\d{2})?(?:hs)?)\s*a\s*(\d{1,2}(?::\d{2})?(?:hs)?)$/i);
  if (m) {
    return { inicioMin: horaAMinutos(m[1], false), finMin: horaAMinutos(m[2], true), todoElDia: false };
  }

  m = s.match(/^desde\s+(?:las?\s+)?(\d{1,2}(?::\d{2})?(?:hs)?)$/i);
  if (m) {
    return { inicioMin: horaAMinutos(m[1], false), finMin: null, todoElDia: false };
  }

  m = s.match(/^hasta\s+(?:las?\s+)?(\d{1,2}(?::\d{2})?(?:hs)?)$/i);
  if (m) {
    return { inicioMin: null, finMin: horaAMinutos(m[1], true), todoElDia: false };
  }

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

    const dia   = detectarDia(seg);
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
  const DURACION = 75;
  const GRANULARIDAD = 15;

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

      let inicio = aperturaMin;
      if (rango.inicioMin !== null) {
        inicio = Math.max(aperturaMin, rango.inicioMin - margenMinutos);
      }

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
  requireConfirmarDev('importar-parejas-test.js');

  const args = parseArgs();

  if (!args.archivo || !args.torneoId) {
    console.error('USO: node scripts/dev-tools/importar-parejas-test.js --confirmar-dev --archivo=ruta.xlsx --torneoId=<id> [--margenMinutos=60]');
    process.exit(1);
  }

  const archivoPath   = path.resolve(args.archivo);
  const torneoId      = args.torneoId;
  const margenMinutos = args.margenMinutos !== undefined ? parseInt(args.margenMinutos, 10) : 0;

  // ── 1. Leer el XLSX ───────────────────────────────────────────────────────
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

  if (filas.length < 2) {
    console.error('❌ El archivo está vacío o solo tiene encabezados.');
    process.exit(1);
  }

  const filasDatos = filas.slice(1);

  // ── 2. Cargar torneo + categorías + organizador desde la DB ──────────────
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
    include: {
      categorias: true,
      organizador: true,
    },
  });

  if (!torneo) {
    console.error(`❌ No se encontró ningún torneo con id="${torneoId}".`);
    process.exit(1);
  }

  crearBackupDevDb();

  console.log(`\n✅ Torneo encontrado: "${torneo.nombre}"`);
  console.log(`   Categorías: ${torneo.categorias.map(c => c.nombre).join(', ')}`);
  console.log(`   Club: ${torneo.organizador.nombre}`);
  console.log(`   Grilla — Viernes: ${torneo.organizador.viernesInicio ?? 'N/A'} a ${torneo.organizador.viernesFin ?? 'N/A'}`);
  console.log(`   Grilla — Sábado:  ${torneo.organizador.sabadoInicio  ?? 'N/A'} a ${torneo.organizador.sabadoFin  ?? 'N/A'}`);
  console.log(`   Margen aplicado: ${margenMinutos} minutos antes y después de cada rango`);
  console.log(`\n📋 Procesando ${filasDatos.length} filas del archivo...\n`);

  const categoriasMap = new Map(
    torneo.categorias.map(c => [c.nombre.trim().toLowerCase(), c])
  );

  const ordenPorCategoria = new Map();
  for (const cat of torneo.categorias) {
    const count = await prisma.pareja.count({ where: { categoriaId: cat.id } });
    ordenPorCategoria.set(cat.id, count);
  }

  // ── 3. Procesar cada fila ─────────────────────────────────────────────────
  const stats = {
    total:      0,
    guardadas:  0,
    salteadas:  [],
  };

  for (let i = 0; i < filasDatos.length; i++) {
    const fila    = filasDatos[i];
    const numFila = i + 2;

    if (fila.every(c => !String(c).trim())) continue;

    stats.total++;

    const apellido1   = String(fila[0] ?? '').trim();
    const apellido2   = String(fila[1] ?? '').trim();
    const catNombre   = String(fila[2] ?? '').trim();
    const horariosRaw = String(fila[3] ?? '').trim();

    if (!catNombre) {
      const motivo = 'Columna Categoría vacía';
      console.warn(`⚠️  Fila ${numFila} salteada — ${motivo}`);
      stats.salteadas.push({ fila: numFila, jugador1: apellido1, jugador2: apellido2, catNombre, horariosRaw, motivo });
      continue;
    }

    const categoria = categoriasMap.get(catNombre.toLowerCase());
    if (!categoria) {
      const motivo = `Categoría "${catNombre}" no encontrada en el torneo`;
      console.warn(`⚠️  Fila ${numFila} salteada — ${motivo}`);
      stats.salteadas.push({ fila: numFila, jugador1: apellido1, jugador2: apellido2, catNombre, horariosRaw, motivo });
      continue;
    }

    const jugador1 = apellido1 || `Jugador A (fila ${numFila})`;
    const jugador2 = apellido2 || `Jugador B (fila ${numFila})`;

    const parseResult = parsearHorarios(horariosRaw);

    if (!parseResult) {
      const motivo = `Horario vacío o no reconocible: "${horariosRaw}"`;
      console.warn(`⚠️  Fila ${numFila} salteada — ${motivo}  (${jugador1} / ${jugador2})`);
      stats.salteadas.push({ fila: numFila, jugador1, jugador2, catNombre, horariosRaw, motivo });
      continue;
    }

    if (parseResult.error) {
      const motivo = `Error al parsear horarios — ${parseResult.error}`;
      console.warn(`⚠️  Fila ${numFila} salteada — ${motivo}  (${jugador1} / ${jugador2})`);
      stats.salteadas.push({ fila: numFila, jugador1, jugador2, catNombre, horariosRaw, motivo });
      continue;
    }

    const slots = calcularSlots(torneo.organizador, parseResult, margenMinutos);

    if (slots.length === 0) {
      const motivo = `Ningún slot de la grilla cae dentro del horario indicado (incluso con margen): "${horariosRaw}"`;
      console.warn(`⚠️  Fila ${numFila} salteada — ${motivo}  (${jugador1} / ${jugador2})`);
      stats.salteadas.push({ fila: numFila, jugador1, jugador2, catNombre, horariosRaw, motivo });
      continue;
    }

    const orden = (ordenPorCategoria.get(categoria.id) || 0) + 1;
    ordenPorCategoria.set(categoria.id, orden);

    await prisma.pareja.create({
      data: {
        categoriaId: categoria.id,
        jugador1,
        jugador2,
        orden,
        slotsSeleccionados: {
          create: slots.map(slotId => ({ slotId })),
        },
      },
    });

    stats.guardadas++;
    console.log(`✅ Fila ${numFila} → [${categoria.nombre}] ${jugador1} / ${jugador2} — ${slots.length} slot(s)`);
  }

  // ── 4. Resumen final ──────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(62));
  console.log('  RESUMEN DE IMPORTACIÓN');
  console.log('═'.repeat(62));
  console.log(`  Total filas procesadas : ${stats.total}`);
  console.log(`  Parejas creadas        : ${stats.guardadas}`);
  console.log(`  Filas salteadas        : ${stats.salteadas.length}`);
  console.log('═'.repeat(62) + '\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('❌ Error inesperado:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
