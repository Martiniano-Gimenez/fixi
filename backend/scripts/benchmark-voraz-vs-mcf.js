const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const zonaService = require('../src/services/zona.service');
const { parseFechaLocal, getDiaCalendarioConTrasnoche, requireTorneoFecha } = require('../src/utils/dateUtils');
const { horaAMinutos } = require('../src/services/slots.service');

function simularBucleVoraz(partidosAReprogramar, overrideNum, friDayStartMs, satDayStartMs, refFecha, organizador, DURACION_MS) {
  const courtTimelines = new Map();
  for (let c = 1; c <= overrideNum; c++) {
    courtTimelines.set(c, []);
  }
  const parejaAssignments = new Map();

  function isCourtFree(cancha, startMs, endMs) {
    const timeline = courtTimelines.get(cancha) || [];
    for (const interval of timeline) {
      if (startMs < interval.endMs && endMs > interval.startMs) return false;
    }
    return true;
  }

  function isPairFree(parejaId, startMs, endMs) {
    if (!parejaId) return true;
    const intervals = parejaAssignments.get(parejaId) || [];
    for (const interval of intervals) {
      if (startMs < interval.endMs && endMs > interval.startMs) return false;
    }
    return true;
  }

  function addInterval(cancha, p1Id, p2Id, startMs, endMs) {
    if (cancha && cancha <= overrideNum && courtTimelines.has(cancha)) {
      courtTimelines.get(cancha).push({ startMs, endMs });
    }
    if (p1Id) {
      if (!parejaAssignments.has(p1Id)) parejaAssignments.set(p1Id, []);
      parejaAssignments.get(p1Id).push({ startMs, endMs });
    }
    if (p2Id) {
      if (!parejaAssignments.has(p2Id)) parejaAssignments.set(p2Id, []);
      parejaAssignments.get(p2Id).push({ startMs, endMs });
    }
  }

  const sorted = [...partidosAReprogramar].sort((a, b) => {
    const tA = new Date(a.fechaHora).getTime();
    const tB = new Date(b.fechaHora).getTime();
    if (tA !== tB) return tA - tB;
    if ((a.canchaNumero || 0) !== (b.canchaNumero || 0)) {
      return (a.canchaNumero || 0) - (b.canchaNumero || 0);
    }
    return a.id.localeCompare(b.id);
  });

  const results = [];
  for (const partido of sorted) {
    const origStartMs = new Date(partido.fechaHora).getTime();
    const origDate = new Date(origStartMs);
    const origDiaInfo = getDiaCalendarioConTrasnoche(origDate, organizador);
    const dayLimit = new Date(origDiaInfo.dayLimitMs);
    const isFriday = origDiaInfo.logicalDate.getDay() === 5;
    const sessionDayStartMs = isFriday ? friDayStartMs : satDayStartMs;

    const slotsP1 = (partido.pareja1?.slotsSeleccionados || []).map((s) => s.slotId);
    const slotsP2 = (partido.pareja2?.slotsSeleccionados || []).map((s) => s.slotId);
    const diaPrefix = isFriday ? 'Viernes' : 'Sabado';
    const daySlotsP1 = slotsP1.filter((s) => s.startsWith(diaPrefix));
    const daySlotsP2 = slotsP2.filter((s) => s.startsWith(diaPrefix));

    let minSlotMs = null;
    if (daySlotsP1.length > 0 && daySlotsP2.length > 0) {
      const set2 = new Set(daySlotsP2);
      const common = daySlotsP1.filter((s) => set2.has(s));
      if (common.length > 0) {
        const times = common.map((s) => zonaService.parseSlotToDate(s, refFecha).getTime());
        minSlotMs = Math.min(...times);
      }
    } else if (daySlotsP1.length > 0 || daySlotsP2.length > 0) {
      const single = daySlotsP1.length > 0 ? daySlotsP1 : daySlotsP2;
      const times = single.map((s) => zonaService.parseSlotToDate(s, refFecha).getTime());
      minSlotMs = Math.min(...times);
    }

    let startSearchMs = minSlotMs !== null ? Math.max(sessionDayStartMs, minSlotMs) : sessionDayStartMs;
    const remainder = startSearchMs % (15 * 60 * 1000);
    if (remainder !== 0) {
      startSearchMs += 15 * 60 * 1000 - remainder;
    }

    let asignado = false;
    let candidateT = startSearchMs;

    while (candidateT + DURACION_MS <= dayLimit.getTime()) {
      const candidateEnd = candidateT + DURACION_MS;
      let freeCourt = null;

      for (let c = 1; c <= overrideNum; c++) {
        if (
          isCourtFree(c, candidateT, candidateEnd) &&
          isPairFree(partido.pareja1Id, candidateT, candidateEnd) &&
          isPairFree(partido.pareja2Id, candidateT, candidateEnd)
        ) {
          freeCourt = c;
          break;
        }
      }

      if (freeCourt !== null) {
        addInterval(freeCourt, partido.pareja1Id, partido.pareja2Id, candidateT, candidateEnd);
        results.push({
          id: partido.id,
          fechaHora: new Date(candidateT),
          canchaNumero: freeCourt,
          sinHorarioAsignado: false,
        });
        asignado = true;
        break;
      }
      candidateT += 15 * 60 * 1000;
    }

    if (!asignado) {
      results.push({
        id: partido.id,
        fechaHora: null,
        canchaNumero: null,
        sinHorarioAsignado: true,
      });
    }
  }
  return results;
}

async function runBenchmark() {
  console.log('🏁 Iniciando Benchmark Masivo: 6 → 4 Canchas (Simulación Torneo Completo)...\n');

  const organizador = await prisma.organizador.create({
    data: {
      nombre: 'Club Benchmark Masivo',
      email: `bench-masivo-${Date.now()}@padel.com`,
      passwordHash: 'hash',
      cantidadCanchas: 6,
      viernesInicio: '14:00',
      viernesFin: '02:00',
      sabadoInicio: '09:00',
      sabadoFin: '02:00',
    },
  });

  const fechaTorneo = '2026-09-04';
  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Multi-Categoría Benchmark',
      slug: `bench-multi-${Date.now()}`,
      fecha: parseFechaLocal(fechaTorneo),
      estado: 'BORRADOR',
      organizadorId: organizador.id,
    },
  });

  // 2 Categorías (4ta, 6ta) con 12 parejas cada una = 24 partidos
  const catNames = ['4ta', '6ta'];
  const catIds = [];
  const todasLasParejas = [];

  for (const name of catNames) {
    const cat = await prisma.categoria.create({
      data: { torneoId: torneo.id, nombre: name, estado: 'BORRADOR' },
    });
    catIds.push(cat.id);

    for (let i = 1; i <= 12; i++) {
      const p = await prisma.pareja.create({
        data: {
          categoriaId: cat.id,
          jugador1: `J1_${name}_${i}`,
          jugador2: `J2_${name}_${i}`,
          orden: i,
        },
      });
      todasLasParejas.push(p);

      // Disponibilidades variadas:
      // i = 1..4: Rígidos de tarde (14:00 a 18:00)
      // i = 5..8: Rígidos de noche (19:00 a 23:00)
      // i = 9..12: Amplios (14:00 a 01:00)
      let startMin = 14 * 60;
      let endMin = 25 * 60;
      if (i <= 4) {
        startMin = 14 * 60;
        endMin = 18 * 60;
      } else if (i <= 8) {
        startMin = 19 * 60;
        endMin = 23 * 60;
      }

      const slots = [];
      for (let m = startMin; m + 75 <= endMin; m += 15) {
        const clockM = m % (24 * 60);
        const hh = Math.floor(clockM / 60).toString().padStart(2, '0');
        const mm = (clockM % 60).toString().padStart(2, '0');
        slots.push(`Viernes-${hh}:${mm}`);
      }

      for (const s of slots) {
        await prisma.slotPareja.create({
          data: { parejaId: p.id, slotId: s },
        });
      }
    }

    await zonaService.iniciarCategoriaConDisponibilidad(organizador.id, cat.id);
  }

  // Iniciar asignación global en 6 canchas
  await zonaService.asignarHorariosAutomatico(organizador.id, catIds);
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });

  const partidosIniciales = await prisma.partido.findMany({
    where: { categoria: { torneoId: torneo.id } },
    include: {
      pareja1: { include: { slotsSeleccionados: true } },
      pareja2: { include: { slotsSeleccionados: true } },
    },
  });

  const refFecha = requireTorneoFecha(torneo);
  const baseFriday = zonaService.proximaFechaPorDia('Viernes', refFecha);
  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', refFecha);
  const friDayStartMs = baseFriday.getTime() + horaAMinutos(organizador.viernesInicio) * 60 * 1000;
  const satDayStartMs = baseSaturday.getTime() + horaAMinutos(organizador.sabadoInicio) * 60 * 1000;
  const DURACION_MS = 75 * 60 * 1000;

  // ==========================================
  // Versión A: BUCLE VORAZ ANTERIOR
  // ==========================================
  const vorazResults = simularBucleVoraz(partidosIniciales, 4, friDayStartMs, satDayStartMs, refFecha, organizador, DURACION_MS);

  // ==========================================
  // Versión B: SCHEDULER MCF NUEVO
  // ==========================================
  const mcfRes = await zonaService.asignarHorariosModoLluviaMCF(organizador.id, torneo.id, 4);
  const mcfPartidos = await prisma.partido.findMany({
    where: { categoria: { torneoId: torneo.id } },
  });

  // Métricas Voraz
  const vorazTimes = vorazResults.filter(p => p.fechaHora).map(p => p.fechaHora.getTime());
  const vorazMaxMs = Math.max(...vorazTimes);
  const vorazMaxDate = new Date(vorazMaxMs);
  const vorazSinHorario = vorazResults.filter(p => p.sinHorarioAsignado || !p.fechaHora).length;
  const vorazAsignados = vorazResults.filter(p => p.fechaHora).length;

  // Métricas MCF
  const mcfTimes = mcfPartidos.filter(p => p.fechaHora).map(p => new Date(p.fechaHora).getTime());
  const mcfMaxMs = Math.max(...mcfTimes);
  const mcfMaxDate = new Date(mcfMaxMs);
  const mcfSinHorario = mcfPartidos.filter(p => p.sinHorarioAsignado || !p.fechaHora).length;
  const mcfAsignados = mcfPartidos.filter(p => p.fechaHora).length;

  function fmtHora(d) {
    if (!d || isNaN(d.getTime())) return 'N/A';
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
  }

  function fmtHoraFin(d) {
    if (!d || isNaN(d.getTime())) return 'N/A';
    const end = new Date(d.getTime() + DURACION_MS);
    return end.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
  }

  console.log('================================================================');
  console.log('📊 RESULTADOS COMPARATIVOS EXACTOS (TORNEO 36 PARTIDOS, 6 → 4 CANCHAS):');
  console.log('================================================================');
  console.log(`Total Partidos a Programar: ${partidosIniciales.length}`);
  console.log('----------------------------------------------------------------');
  console.log(`🔹 BUCLE VORAZ ANTERIOR:`);
  console.log(`   - Último partido inicia: ${fmtHora(vorazMaxDate)} (Cierre jornada: ${fmtHoraFin(vorazMaxDate)}) [ISO: ${vorazMaxDate.toISOString()}]`);
  console.log(`   - Partidos Asignados: ${vorazAsignados}`);
  console.log(`   - Partidos Sin Horario: ${vorazSinHorario}`);
  console.log('----------------------------------------------------------------');
  console.log(`✨ SCHEDULER MCF (3 PASADAS):`);
  console.log(`   - Último partido inicia: ${fmtHora(mcfMaxDate)} (Cierre jornada: ${fmtHoraFin(mcfMaxDate)}) [ISO: ${mcfMaxDate.toISOString()}]`);
  console.log(`   - Partidos Asignados: ${mcfAsignados}`);
  console.log(`   - Partidos Sin Horario: ${mcfSinHorario}`);
  console.log('================================================================\n');

  // Limpieza
  await prisma.partido.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
  await prisma.zona.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
  await prisma.slotPareja.deleteMany({ where: { parejaId: { in: todasLasParejas.map(p => p.id) } } });
  await prisma.pareja.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
  await prisma.categoria.deleteMany({ where: { torneoId: torneo.id } });
  await prisma.torneo.deleteMany({ where: { id: torneo.id } });
  await prisma.organizador.deleteMany({ where: { id: organizador.id } });
}

runBenchmark().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
