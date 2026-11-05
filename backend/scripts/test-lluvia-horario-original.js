'use strict';

// Modo lluvia: el viernes nadie juega antes del inicio de su disponibilidad y todo termina antes del cierre;
// lo que no entra pasa al sábado. El sábado se apila desde la apertura. Nada queda antes de la hora actual.
// Se guarda el horario de antes de la lluvia (solo la primera reducción) y restaurar lo devuelve.
const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('assert');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');

const DURACION_MS = 75 * 60 * 1000;
const VIE = '2026-11-13';
const SAB = '2026-11-14';
const local = (dia, h, m = 0) => new Date(2026, 10, dia, h, m, 0, 0); // noviembre = 10
const JUEVES = local(12, 12); // "ahora" antes del torneo: sin piso
const HORARIOS = { viernesInicio: '18:00', viernesFin: '00:00', sabadoInicio: '08:00', sabadoFin: '02:00', domingoInicio: '08:00', domingoFin: '23:00' };
const CIERRE_VIERNES = local(14, 0).getTime();
const APERTURA_SABADO = local(14, 8).getTime();
const jornada = (f) => getDiaCalendarioConTrasnoche(f, HORARIOS).key;
const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function slotsViernesDesde(h, m) {
  const lista = [];
  for (let t = h * 60 + m; t <= 23 * 60; t += 15) {
    lista.push(`Viernes-${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return lista;
}

async function crearEscenario() {
  const org = await prisma.organizador.create({
    data: { nombre: 'Club Lluvia Original', email: 'lluvia-original@padel.test', passwordHash: 'x', cantidadCanchas: 6, ...HORARIOS },
  });
  const torneo = await prisma.torneo.create({
    data: { nombre: 'Lluvia original', slug: 'lluvia-original', fecha: local(13, 12), estado: 'EN_CURSO', organizadorId: org.id },
  });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO' } });
  const cat6 = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' } });

  // Inicio de disponibilidad del viernes por zona y pareja (null = sin horarios cargados)
  const inicios = [
    [[18, 0], [18, 0], [18, 0]], [[18, 0], [18, 0], [18, 0]], [[18, 0], [18, 0], [18, 0]], [[18, 0], [18, 0], [18, 0]],
    [[18, 0], [19, 30], [18, 0]], [[19, 0], [19, 0], [19, 0]], [null, null, null], [null, [20, 0], null],
  ];
  const rondas = [local(13, 18), local(13, 19, 15), local(13, 20, 30), local(13, 21, 45)];
  const ocupadasPorRonda = [0, 0, 0, 0];
  let orden = 1;
  const parejas = new Map();
  for (let z = 0; z < 8; z++) {
    const zona = await prisma.zona.create({ data: { categoriaId: cat.id, nombre: `Zona ${String.fromCharCode(65 + z)}`, clasifican: 2 } });
    const pz = [];
    for (let i = 0; i < 3; i++) {
      const p = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: `Z${z}J${i}a`, jugador2: `Z${z}J${i}b`, orden: orden++ } });
      const ini = inicios[z][i];
      const slots = ini ? [...slotsViernesDesde(ini[0], ini[1]), 'Sabado-10:00', 'Sabado-10:15'] : [];
      for (const slotId of slots) await prisma.slotPareja.create({ data: { parejaId: p.id, slotId } });
      await prisma.zonaPareja.create({ data: { zonaId: zona.id, parejaId: p.id } });
      parejas.set(p.id, ini ? local(13, ini[0], ini[1]).getTime() : null);
      pz.push(p);
    }
    const cruces = [[0, 1], [0, 2], [1, 2]];
    for (let k = 0; k < 3; k++) {
      // El tercer partido de la última zona se juega el sábado 08:00 en la cancha 1 (comparte parejas con el viernes)
      const esSabado = z === 7 && k === 2;
      const r = (z + k) % 4;
      const fechaHora = esSabado ? local(14, 8) : rondas[r];
      const canchaNumero = esSabado ? 1 : ++ocupadasPorRonda[r];
      await prisma.partido.create({
        data: {
          categoriaId: cat.id, zonaId: zona.id, posicionEnRonda: k + 1,
          pareja1Id: pz[cruces[k][0]].id, pareja2Id: pz[cruces[k][1]].id,
          estado: 'PENDIENTE', fechaHora, canchaNumero, sinHorarioAsignado: false,
        },
      });
    }
  }

  // 6ta: ocho partidos del sábado (08:00 en canchas 2 a 5 y 10:00 en canchas 3 a 6)
  for (let i = 0; i < 8; i++) {
    const zona = await prisma.zona.create({ data: { categoriaId: cat6.id, nombre: `Zona ${i + 1}`, clasifican: 1 } });
    const a = await prisma.pareja.create({ data: { categoriaId: cat6.id, jugador1: `S${i}a`, jugador2: `S${i}b`, orden: i * 2 + 1 } });
    const b = await prisma.pareja.create({ data: { categoriaId: cat6.id, jugador1: `S${i}c`, jugador2: `S${i}d`, orden: i * 2 + 2 } });
    await prisma.partido.create({
      data: {
        categoriaId: cat6.id, zonaId: zona.id, posicionEnRonda: 1, pareja1Id: a.id, pareja2Id: b.id, estado: 'PENDIENTE',
        fechaHora: i < 4 ? local(14, 8) : local(14, 10), canchaNumero: i < 4 ? i + 2 : i - 1, sinHorarioAsignado: false,
      },
    });
  }
  return { org, torneo, parejas };
}

const leerPartidos = (torneoId) => prisma.partido.findMany({ where: { categoria: { torneoId } }, orderBy: { id: 'asc' } });
const leerRegistro = async (torneoId, diaKey) => {
  const ov = await prisma.overrideCanchasDia.findUnique({ where: { torneoId_diaKey: { torneoId, diaKey } } });
  if (!ov) return null;
  return typeof ov.horariosAntesLluvia === 'string' ? JSON.parse(ov.horariosAntesLluvia) : ov.horariosAntesLluvia;
};

// Ninguna cancha ni pareja con dos partidos a la vez
function verificarSinChoques(partidos, etiqueta) {
  const conHorario = partidos.filter((p) => p.fechaHora && !p.sinHorarioAsignado);
  for (let i = 0; i < conHorario.length; i++) {
    for (let j = i + 1; j < conHorario.length; j++) {
      const a = conHorario[i];
      const b = conHorario[j];
      const sa = a.fechaHora.getTime();
      const sb = b.fechaHora.getTime();
      if (!(sa < sb + DURACION_MS && sb < sa + DURACION_MS)) continue;
      assert.ok(a.canchaNumero !== b.canchaNumero, `${etiqueta}: cancha ${a.canchaNumero} con dos partidos a las ${hhmm(sa)}/${hhmm(sb)}`);
      const pa = [a.pareja1Id, a.pareja2Id];
      assert.ok(!pa.includes(b.pareja1Id) && !pa.includes(b.pareja2Id), `${etiqueta}: una pareja juega dos partidos a la vez (${hhmm(sa)}/${hhmm(sb)})`);
    }
  }
}

async function main() {
  await ensureTestDb();
  await canchasOverridesService.loadFromDb();
  const { org, torneo, parejas } = await crearEscenario();
  const reducir = (canchas, diaKey, ahora) => organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, canchas, ahora, diaKey);

  const inicial = await leerPartidos(torneo.id);
  const delViernes = inicial.filter((p) => jornada(p.fechaHora) === VIE);
  const sabadoAntes = inicial.filter((p) => jornada(p.fechaHora) === SAB);
  assert.strictEqual(delViernes.length, 23);

  // ── 1. Viernes 6 → 4 ──────────────────────────────────────────────────────────────────────────────
  await reducir(4, VIE, JUEVES);
  let partidos = await leerPartidos(torneo.id);
  const porId = (lista) => new Map(lista.map((p) => [p.id, p]));
  let actuales = porId(partidos);
  const pasaronAlSabado = [];
  for (const original of delViernes) {
    const p = actuales.get(original.id);
    assert.ok(p.fechaHora && !p.sinHorarioAsignado, 'Con estas canchas todo entra entre el viernes y el sábado');
    const inicio = p.fechaHora.getTime();
    if (jornada(p.fechaHora) === VIE) {
      const pisos = [parejas.get(p.pareja1Id), parejas.get(p.pareja2Id)].filter((v) => v !== null);
      const piso = pisos.length ? Math.max(...pisos) : local(13, 18).getTime();
      assert.ok(inicio >= piso, `Viernes: un partido empieza a las ${hhmm(inicio)}, antes del inicio de sus parejas (${hhmm(piso)})`);
      assert.ok(inicio + DURACION_MS <= CIERRE_VIERNES, `Viernes: un partido termina después del cierre (${hhmm(inicio)})`);
      assert.ok(p.canchaNumero <= 4, 'Viernes: solo canchas habilitadas');
    } else {
      assert.strictEqual(jornada(p.fechaHora), SAB, 'Lo que no entra el viernes pasa al sábado');
      assert.ok(inicio >= APERTURA_SABADO);
      pasaronAlSabado.push(p.id);
    }
  }
  assert.ok(pasaronAlSabado.length >= 5, `Pasan al sábado los que no entran el viernes (${pasaronAlSabado.length})`);
  for (const s of sabadoAntes) {
    const p = actuales.get(s.id);
    assert.strictEqual(p.fechaHora.getTime(), s.fechaHora.getTime(), 'El sábado no se mueve');
    assert.strictEqual(p.canchaNumero, s.canchaNumero);
  }
  verificarSinChoques(partidos, 'Viernes 6→4');
  // El partido de zona 7 que se juega el sábado 08:00 comparte parejas: los suyos que pasan no van a las 08:00
  const registroViernes = await leerRegistro(torneo.id, VIE);
  assert.deepStrictEqual(Object.keys(registroViernes).sort(), delViernes.map((p) => p.id).sort(), 'El registro guarda los pendientes del viernes');
  for (const p of delViernes) {
    assert.strictEqual(registroViernes[p.id].fechaHora, p.fechaHora.toISOString());
    assert.strictEqual(registroViernes[p.id].canchaNumero, p.canchaNumero);
  }
  console.log(`OK viernes 6→4: piso por parejas, cierre a las 00:00 y ${pasaronAlSabado.length} partidos pasan al sábado sin choques`);

  // ── 2. Un partido termina durante la lluvia ───────────────────────────────────────────────────────
  // Uno que la lluvia movió dentro del viernes: puede ocupar el horario original de otros
  const originalDe = new Map(delViernes.map((p) => [p.id, p]));
  const finalizado = partidos.find((p) => originalDe.has(p.id) && jornada(p.fechaHora) === VIE
    && (p.fechaHora.getTime() !== originalDe.get(p.id).fechaHora.getTime() || p.canchaNumero !== originalDe.get(p.id).canchaNumero));
  assert.ok(finalizado, 'Hay un partido que la lluvia movió dentro del viernes');
  await prisma.partido.update({ where: { id: finalizado.id }, data: { estado: 'FINALIZADO', ganadorId: finalizado.pareja1Id } });

  // ── 3. Viernes 4 → 3: el registro de la primera reducción se conserva ─────────────────────────────
  await reducir(3, VIE, JUEVES);
  assert.deepStrictEqual(await leerRegistro(torneo.id, VIE), registroViernes, 'Una segunda reducción no pisa el registro');
  verificarSinChoques(await leerPartidos(torneo.id), 'Viernes 4→3');
  console.log('OK viernes 4→3: conserva el registro de la primera reducción');

  // ── 4. Restaurar el viernes ───────────────────────────────────────────────────────────────────────
  await reducir(null, VIE, JUEVES);
  partidos = await leerPartidos(torneo.id);
  actuales = porId(partidos);
  assert.strictEqual(await leerRegistro(torneo.id, VIE), null, 'Se borra el override con su registro');
  const f = actuales.get(finalizado.id);
  assert.strictEqual(f.fechaHora.getTime(), finalizado.fechaHora.getTime(), 'El finalizado no cambia');
  assert.strictEqual(f.canchaNumero, finalizado.canchaNumero);
  const chocaConFinalizado = (o) => {
    const s = o.fechaHora.getTime();
    const fs = finalizado.fechaHora.getTime();
    if (!(s < fs + DURACION_MS && fs < s + DURACION_MS)) return false;
    return o.canchaNumero === finalizado.canchaNumero
      || [o.pareja1Id, o.pareja2Id].some((id) => id === finalizado.pareja1Id || id === finalizado.pareja2Id);
  };
  let volvieron = 0;
  let desplazados = 0;
  for (const o of delViernes) {
    if (o.id === finalizado.id) continue;
    const p = actuales.get(o.id);
    if (!chocaConFinalizado(o)) {
      assert.strictEqual(p.fechaHora.getTime(), o.fechaHora.getTime(), `Vuelve a su horario original (${hhmm(o.fechaHora.getTime())})`);
      assert.strictEqual(p.canchaNumero, o.canchaNumero);
      volvieron++;
    } else {
      // Si no puede volver: después de su horario original, en el viernes y antes del cierre; si no entra, sin horario
      if (p.fechaHora) {
        assert.ok(p.fechaHora.getTime() >= o.fechaHora.getTime(), 'Si no puede volver, va después de su horario original');
        assert.strictEqual(jornada(p.fechaHora), VIE, 'En su jornada original');
        assert.ok(p.fechaHora.getTime() + DURACION_MS <= CIERRE_VIERNES, 'Antes del cierre del viernes');
      } else {
        assert.strictEqual(p.sinHorarioAsignado, true);
      }
      desplazados++;
    }
  }
  assert.ok(desplazados >= 1, 'El finalizado ocupa el horario original de al menos un partido');
  assert.ok(pasaronAlSabado.filter((id) => id !== finalizado.id).every((id) => !actuales.get(id).fechaHora || jornada(actuales.get(id).fechaHora) === VIE),
    'Los que habían pasado al sábado vuelven al viernes');
  assert.ok(volvieron >= 18, `La mayoría vuelve exacto a su horario (${volvieron})`);
  verificarSinChoques(partidos, 'Restaurar viernes');
  console.log(`OK restaurar viernes: ${volvieron} vuelven a su horario, incluidos los que habían pasado al sábado; ${desplazados} ${desplazados === 1 ? "va" : "van"} más tarde por el finalizado, que no cambia`);

  // ── 5. Sábado 6 → 4: se apila desde la apertura ───────────────────────────────────────────────────
  await reducir(4, SAB, JUEVES);
  partidos = await leerPartidos(torneo.id);
  const delSabado = partidos.filter((p) => p.estado === 'PENDIENTE' && p.fechaHora && jornada(p.fechaHora) === SAB);
  assert.deepStrictEqual(delSabado.map((p) => hhmm(p.fechaHora.getTime())).sort(),
    ['08:00', '08:00', '08:00', '08:00', '09:15', '09:15', '09:15', '09:15', '10:30'], 'Sábado: se apila desde la apertura');
  assert.ok(delSabado.every((p) => p.canchaNumero <= 4));
  verificarSinChoques(partidos, 'Sábado 6→4');
  await reducir(null, SAB, JUEVES);
  partidos = await leerPartidos(torneo.id);
  actuales = porId(partidos);
  for (const s of sabadoAntes) {
    assert.strictEqual(actuales.get(s.id).fechaHora.getTime(), s.fechaHora.getTime(), 'Restaurar el sábado devuelve su horario');
  }
  console.log('OK sábado 6→4: se apila desde las 08:00; restaurar lo devuelve');

  // ── 6. Nada antes de la hora actual ───────────────────────────────────────────────────────────────
  const sabado905 = local(14, 9, 5);
  await reducir(4, SAB, sabado905);
  partidos = await leerPartidos(torneo.id);
  const pendientesSab = partidos.filter((p) => p.estado === 'PENDIENTE' && p.fechaHora && jornada(p.fechaHora) === SAB);
  assert.ok(pendientesSab.every((p) => p.fechaHora.getTime() >= local(14, 9, 15).getTime()), 'Sábado: nada antes de las 09:15');
  assert.strictEqual(Math.min(...pendientesSab.map((p) => p.fechaHora.getTime())), local(14, 9, 15).getTime());
  await reducir(null, SAB, sabado905);
  partidos = await leerPartidos(torneo.id);
  const tras = partidos.filter((p) => p.estado === 'PENDIENTE' && p.fechaHora && jornada(p.fechaHora) === SAB);
  assert.ok(tras.every((p) => p.fechaHora.getTime() >= local(14, 9, 15).getTime()), 'Al restaurar, lo que ya pasó no vuelve antes de la hora actual');
  verificarSinChoques(partidos, 'Sábado con hora actual');

  const viernes1940 = local(13, 19, 40);
  await reducir(4, VIE, viernes1940);
  partidos = await leerPartidos(torneo.id);
  const pendientesVie = partidos.filter((p) => p.estado === 'PENDIENTE' && p.fechaHora && jornada(p.fechaHora) === VIE);
  assert.ok(pendientesVie.length > 0);
  assert.ok(pendientesVie.every((p) => p.fechaHora.getTime() >= local(13, 19, 45).getTime()), 'Viernes: nada antes de las 19:45');
  verificarSinChoques(partidos, 'Viernes con hora actual');
  await reducir(null, VIE, viernes1940);
  partidos = await leerPartidos(torneo.id);
  assert.ok(partidos.filter((p) => p.estado === 'PENDIENTE' && p.fechaHora && jornada(p.fechaHora) === VIE)
    .every((p) => p.fechaHora.getTime() >= local(13, 19, 45).getTime()), 'Restaurar el viernes tampoco pone nada antes de la hora actual');
  verificarSinChoques(partidos, 'Restaurar viernes con hora actual');
  console.log('OK hora actual: nada se acomoda antes de la hora actual redondeada a 15 min');

  console.log('\nPASS test-lluvia-horario-original');
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(0)))
  .catch((e) => {
    console.error(e);
    prisma.$disconnect().finally(() => process.exit(1));
  });
