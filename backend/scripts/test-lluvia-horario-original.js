'use strict';

// Modo lluvia: el viernes los partidos sin horario respetan el inicio de sus parejas y todos terminan antes del cierre;
// lo que no entra pasa al sábado. Ningún pendiente se adelanta respecto de su horario previo a cada reducción.
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
const JUEVES = local(12, 12); // La hora de invocación nunca es un piso.
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

let numeroEscenario = 0;
async function crearEscenario() {
  const sufijo = ++numeroEscenario;
  const org = await prisma.organizador.create({
    data: { nombre: 'Club Lluvia Original', email: `lluvia-original-${sufijo}@padel.test`, passwordHash: 'x', cantidadCanchas: 6, ...HORARIOS },
  });
  const torneo = await prisma.torneo.create({
    data: { nombre: 'Lluvia original', slug: `lluvia-original-${sufijo}`, fecha: local(13, 12), estado: 'EN_CURSO', organizadorId: org.id },
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

function verificarSinAdelantos(antes, despues, etiqueta) {
  const actuales = new Map(despues.map((p) => [p.id, p]));
  for (const previo of antes) {
    if (previo.estado !== 'PENDIENTE' || !previo.fechaHora || previo.sinHorarioAsignado) continue;
    const actual = actuales.get(previo.id);
    if (!actual.fechaHora) continue;
    assert.ok(actual.fechaHora.getTime() >= previo.fechaHora.getTime(),
      `${etiqueta}: ${previo.id} se adelantó de ${previo.fechaHora.toISOString()} a ${actual.fechaHora.toISOString()}`);
  }
}

async function probarViernesConHuecoPrevio() {
  const org = await prisma.organizador.create({
    data: { nombre: 'Club con hueco', email: 'lluvia-hueco@padel.test', passwordHash: 'x', cantidadCanchas: 6, ...HORARIOS },
  });
  const torneo = await prisma.torneo.create({
    data: { nombre: 'Viernes con hueco', slug: 'lluvia-hueco', fecha: local(13, 12), estado: 'EN_CURSO', organizadorId: org.id },
  });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '7ma', estado: 'EN_CURSO' } });
  // Hay canchas libres desde las 18:00 y las parejas están disponibles, pero ya se les avisó 19:30.
  // Sin el piso por horario previo, los seis partidos se adelantan al reducir a cuatro canchas.
  for (let i = 0; i < 6; i++) {
    const zona = await prisma.zona.create({ data: { categoriaId: cat.id, nombre: `Zona ${i + 1}`, clasifican: 1 } });
    const ids = [];
    for (let j = 0; j < 2; j++) {
      const pareja = await prisma.pareja.create({ data: {
        categoriaId: cat.id, jugador1: `H${i}${j}a`, jugador2: `H${i}${j}b`, orden: i * 2 + j + 1,
        slotsSeleccionados: { create: slotsViernesDesde(18, 0).map((slotId) => ({ slotId })) },
      } });
      ids.push(pareja.id);
    }
    await prisma.partido.create({ data: {
      categoriaId: cat.id, zonaId: zona.id, posicionEnRonda: 1, pareja1Id: ids[0], pareja2Id: ids[1],
      estado: 'PENDIENTE', fechaHora: local(13, 19, 30), canchaNumero: i + 1, sinHorarioAsignado: false,
    } });
  }
  const inicial = await leerPartidos(torneo.id);
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 4, JUEVES, VIE);
  const conCuatro = await leerPartidos(torneo.id);
  assert.ok(conCuatro.every((p) => p.fechaHora && !p.sinHorarioAsignado), 'Los seis partidos entran con cuatro canchas');
  verificarSinAdelantos(inicial, conCuatro, 'Viernes con hueco 6→4');
  assert.strictEqual(conCuatro.filter((p) => p.fechaHora > local(13, 19, 30)).length, 2, 'Dos partidos se atrasan con cuatro canchas');
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 3, JUEVES, VIE);
  const conTres = await leerPartidos(torneo.id);
  assert.ok(conTres.every((p) => p.fechaHora && !p.sinHorarioAsignado), 'Los seis partidos entran con tres canchas');
  verificarSinAdelantos(conCuatro, conTres, 'Viernes con hueco 4→3');
  verificarSinChoques(conTres, 'Viernes con hueco 4→3');
  console.log('OK viernes con hueco 6→4→3: los horarios avisados son pisos, aunque haya lugar antes');
}

const fotoHorarios = (partidos) => partidos.map((p) => [p.id, p.fechaHora?.toISOString() ?? null, p.canchaNumero, p.sinHorarioAsignado]);
function verificarSinAtrasos(antes, despues) {
  const actuales = new Map(despues.map((p) => [p.id, p]));
  for (const p of antes) {
    if (p.estado !== 'PENDIENTE' || !p.fechaHora || p.sinHorarioAsignado) continue;
    const n = actuales.get(p.id);
    assert.ok(n.fechaHora && !n.sinHorarioAsignado, 'Restaurar nunca pierde un horario actual');
    assert.ok(n.fechaHora <= p.fechaHora, 'Restaurar nunca atrasa un partido');
  }
}

async function probarIndependenciaDelReloj() {
  const { org, torneo } = await crearEscenario();
  const inicial = await leerPartidos(torneo.id);
  const reducir = (n, ahora, dia = VIE) => organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, n, ahora, dia);
  let referencia;
  // Incluye antes, durante y después del torneo y el camino real sin mockTimestamp.
  for (const ahora of [local(13, 9), local(14, 17, 43), local(20, 18), null]) {
    await reducir(4, ahora);
    const reducidos = await leerPartidos(torneo.id);
    assert.ok(reducidos.every((p) => p.fechaHora && !p.sinHorarioAsignado), 'La hora no deja partidos sin horario');
    if (referencia) assert.deepStrictEqual(fotoHorarios(reducidos), referencia, 'Reducir no depende del reloj');
    referencia = fotoHorarios(reducidos);
    assert.ok(reducidos.some((p) => jornada(p.fechaHora) === SAB && jornada(inicial.find((o) => o.id === p.id).fechaHora) === VIE));
    await reducir(null, ahora);
    const restaurados = await leerPartidos(torneo.id);
    verificarSinAtrasos(reducidos, restaurados);
    assert.deepStrictEqual(fotoHorarios(restaurados), fotoHorarios(inicial), 'Todos vuelven al original, incluidos los que pasaron al sábado');
    assert.strictEqual(await leerRegistro(torneo.id, VIE), null);
    verificarSinChoques(restaurados, 'Restauración independiente del reloj');
  }
  // Restaurar todo sigue recuperando los registros de ambas jornadas y limpia base y caché.
  await reducir(4, local(14, 17, 43));
  await reducir(4, local(14, 17, 43), SAB);
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, null);
  assert.deepStrictEqual(fotoHorarios(await leerPartidos(torneo.id)), fotoHorarios(inicial));
  assert.strictEqual(await prisma.overrideCanchasDia.count({ where: { torneoId: torneo.id } }), 0);
  assert.deepStrictEqual(canchasOverridesService.getOverridesTorneo(torneo.id), {});
  console.log('OK reloj independiente y restaurar todo: mañana del viernes, tarde del sábado, torneo pasado y sin mock');
}

async function probarDisponibilidadSoloSinHorario() {
  const org = await prisma.organizador.create({ data: {
    nombre: 'Club horarios acordados', email: 'lluvia-acordados@padel.test', passwordHash: 'x', cantidadCanchas: 6,
    ...HORARIOS, viernesInicio: '13:00', viernesFin: '22:00',
  } });
  const torneo = await prisma.torneo.create({ data: {
    nombre: 'Horarios acordados', slug: 'lluvia-acordados', fecha: local(13, 12), estado: 'EN_CURSO', organizadorId: org.id,
  } });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO' } });
  let orden = 0;
  async function crearPartido(nombre, fechaHora, canchaNumero, horarioManual = false, estado = 'PENDIENTE') {
    const zona = await prisma.zona.create({ data: { categoriaId: cat.id, nombre, clasifican: 1 } });
    const parejas = [];
    for (const [jugador1, jugador2, desde, hasta] of [['Dávila', 'Arrieta', 13 * 60, 15 * 60 + 45], ['Tapia', 'Nieva', 17 * 60, 19 * 60 + 45]]) {
      const slots = [];
      for (let m = desde; m + 75 <= hasta; m += 15) {
        slots.push(`Viernes-${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      }
      parejas.push(await prisma.pareja.create({ data: {
        categoriaId: cat.id, jugador1, jugador2, orden: ++orden,
        slotsSeleccionados: { create: slots.map((slotId) => ({ slotId })) },
      } }));
    }
    return prisma.partido.create({ data: {
      categoriaId: cat.id, zonaId: zona.id, posicionEnRonda: 1, pareja1Id: parejas[0].id, pareja2Id: parejas[1].id,
      estado, fechaHora, canchaNumero, horarioManual, sinHorarioAsignado: !fechaHora,
    } });
  }
  const manual = await crearPartido('Manual', local(13, 13, 45), 6, true);
  const automatico = await crearPartido('Automático', local(13, 13, 45), 5);
  const inicial = await leerPartidos(torneo.id);
  const reducir = (n) => organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, n, local(14, 17, 43), VIE);
  await reducir(4);
  let partidos = await leerPartidos(torneo.id);
  for (const p of partidos) {
    assert.strictEqual(p.fechaHora?.getTime(), local(13, 13, 45).getTime(), 'Con horario previo se conservan las 13:45 aunque las parejas no coincidan');
    assert.ok(p.canchaNumero <= 4);
    assert.strictEqual(p.horarioManual, p.id === manual.id, 'La marca manual no cambia');
  }
  verificarSinChoques(partidos, 'Horario acordado con cancha libre');
  const registro = await leerRegistro(torneo.id, VIE);
  assert.strictEqual(registro[manual.id].fechaHora, manual.fechaHora.toISOString());
  assert.strictEqual(registro[automatico.id].fechaHora, automatico.fechaHora.toISOString());
  await reducir(null);
  assert.deepStrictEqual(fotoHorarios(await leerPartidos(torneo.id)), fotoHorarios(inicial), 'Restaurar recupera horario y cancha originales');

  // Las cuatro canchas activas están ocupadas hasta las 15:00: ese es el siguiente inicio posible.
  for (let c = 1; c <= 4; c++) await crearPartido(`Fijo ${c}`, local(13, 13, 45), c, false, 'FINALIZADO');
  const sinHorario = await crearPartido('Sin horario', null, null);
  await reducir(4);
  const registroEstaLluvia = await leerRegistro(torneo.id, VIE);
  partidos = await leerPartidos(torneo.id);
  for (const id of [manual.id, automatico.id]) {
    assert.strictEqual(partidos.find((p) => p.id === id).fechaHora?.getTime(), local(13, 15).getTime(),
      'Sin lugar a las 13:45 se toma el primer hueco a las 15:00, sin saltar a las 17:00');
  }
  // Recuperar un pendiente que una lluvia anterior dejó sin horario, como en el flujo real.
  await canchasOverridesService.setOverrideDia(torneo.id, VIE, 4, JUEVES,
    { [sinHorario.id]: 'Sin cancha activa libre disponible en ese horario' }, null, await leerRegistro(torneo.id, VIE));
  await reducir(3);
  const recuperados = await leerPartidos(torneo.id);
  assert.strictEqual(recuperados.find((p) => p.id === sinHorario.id).fechaHora?.getTime(), local(13, 17).getTime(),
    'Sin horario se sigue respetando el inicio más tardío de las dos parejas, aunque haya lugar desde las 15:00');
  verificarSinAdelantos(partidos, recuperados, 'Disponibilidad solo sin horario');
  verificarSinChoques(recuperados, 'Disponibilidad solo sin horario');
  assert.deepStrictEqual(await leerRegistro(torneo.id, VIE), registroEstaLluvia, 'La segunda reducción conserva el registro original');
  console.log('OK disponibilidad: horario manual y automático a las 13:45, primer hueco a las 15:00 y sin horario desde las 17:00');
}

async function probarJornadasSinEmpezar() {
  const { org, torneo, parejas } = await crearEscenario();
  let inicial = await leerPartidos(torneo.id);
  const sabado = inicial.filter((p) => jornada(p.fechaHora) === SAB);
  for (const p of sabado) {
    await prisma.partido.update({ where: { id: p.id }, data: { fechaHora: new Date(p.fechaHora.getTime() + 2 * 60 * 60 * 1000) } });
  }
  inicial = await leerPartidos(torneo.id);
  const idsViernes = new Set(inicial.filter((p) => jornada(p.fechaHora) === VIE).map((p) => p.id));
  assert.strictEqual(Math.min(...inicial.filter((p) => jornada(p.fechaHora) === SAB).map((p) => p.fechaHora.getTime())), local(14, 10).getTime());
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 3, local(14, 17, 43), VIE);
  const reducidos = await leerPartidos(torneo.id);
  assert.ok(reducidos.every((p) => p.fechaHora && !p.sinHorarioAsignado), 'Con tres canchas todos entran entre viernes y sábado');
  const pasan = reducidos.filter((p) => idsViernes.has(p.id) && jornada(p.fechaHora) === SAB);
  assert.ok(pasan.length > 0);
  assert.strictEqual(Math.min(...pasan.map((p) => p.fechaHora.getTime())), APERTURA_SABADO,
    'Sin empezar el sábado se aprovecha la apertura a las 08:00, aunque el primer pendiente sea a las 10:00');
  verificarSinAdelantos(inicial, reducidos, 'Jornadas sin empezar');
  verificarSinChoques(reducidos, 'Pase a sábado sin empezar');
  for (const p of inicial.filter((p) => jornada(p.fechaHora) === SAB)) {
    assert.deepStrictEqual(reducidos.find((n) => n.id === p.id), p, 'El sábado permanece intacto');
  }
  // Otro pendiente del viernes fuera del registro no impide recuperar los originales: el viernes tampoco empezó.
  const referencia = sabado.find((p) => p.canchaNumero === 2);
  const ajeno = await prisma.partido.create({ data: {
    categoriaId: referencia.categoriaId, zonaId: referencia.zonaId, posicionEnRonda: 2,
    pareja1Id: referencia.pareja1Id, pareja2Id: referencia.pareja2Id,
    estado: 'PENDIENTE', fechaHora: local(13, 23), canchaNumero: 6, sinHorarioAsignado: false,
  } });
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, null, local(14, 17, 43), VIE);
  const restaurados = await leerPartidos(torneo.id);
  verificarSinAtrasos(reducidos, restaurados);
  assert.deepStrictEqual(fotoHorarios(restaurados.filter((p) => p.id !== ajeno.id)), fotoHorarios(inicial),
    'Restaurar una jornada sin empezar usa la apertura aunque otro pendiente ajeno al registro sea posterior');
  assert.deepStrictEqual(restaurados.find((p) => p.id === ajeno.id), ajeno);
  verificarSinChoques(restaurados, 'Restaurar jornada sin empezar');

  // Recuperar un partido sin horario al reducir también debe aprovechar el hueco anterior al primer pendiente.
  await prisma.partido.delete({ where: { id: ajeno.id } });
  const viernes = inicial.filter((p) => idsViernes.has(p.id));
  const aperturaViernes = local(13, 18).getTime();
  const recuperado = viernes.find((p) => p.fechaHora.getTime() === aperturaViernes
    && [p.pareja1Id, p.pareja2Id].every((id) => parejas.get(id) === null || parejas.get(id) <= aperturaViernes));
  for (const p of viernes) {
    await prisma.partido.update({ where: { id: p.id }, data: p.id === recuperado.id
      ? { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true }
      : { fechaHora: new Date(p.fechaHora.getTime() + 2 * 60 * 60 * 1000) } });
  }
  await canchasOverridesService.setOverrideDia(torneo.id, VIE, 5, JUEVES, { [recuperado.id]: 'Sin cancha activa libre disponible en ese horario' });
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 3, local(14, 17, 43), VIE);
  const conRecuperado = await leerPartidos(torneo.id);
  assert.strictEqual(conRecuperado.find((p) => p.id === recuperado.id).fechaHora?.getTime(), local(13, 18).getTime(),
    'Al reducir una jornada sin empezar, el partido sin horario puede usar la apertura anterior al próximo pendiente');
  verificarSinChoques(conRecuperado, 'Reducir jornada sin empezar');
  console.log('OK jornadas sin empezar: pase desde las 08:00, reducción desde apertura y restauración de originales');
}

async function probarPisoProximoPendiente(estadoSabado) {
  const { org, torneo } = await crearEscenario();
  const inicial = await leerPartidos(torneo.id);
  const finalizados = inicial.filter((p) => jornada(p.fechaHora) === VIE && p.fechaHora <= local(13, 18));
  // Terminaron a las 18:00: hay un hueco real hasta el próximo pendiente de las 19:15.
  await prisma.partido.updateMany({ where: { id: { in: finalizados.map((p) => p.id) } },
    data: { estado: 'FINALIZADO', fechaHora: local(13, 16, 45) } });
  // El sábado ya avanzó hasta las 12:00; los huecos de la mañana no son candidatos al pase.
  for (const p of inicial.filter((p) => jornada(p.fechaHora) === SAB)) {
    await prisma.partido.update({ where: { id: p.id }, data: { fechaHora: new Date(p.fechaHora.getTime() + 4 * 60 * 60 * 1000) } });
  }
  const jugadoSabado = inicial.find((p) => jornada(p.fechaHora) === SAB && p.canchaNumero === 2);
  await prisma.partido.update({ where: { id: jugadoSabado.id },
    data: { estado: estadoSabado, fechaHora: local(14, 10, 45) } });
  const previo = await leerPartidos(torneo.id);
  const proximoViernes = Math.min(...previo.filter((p) => p.estado === 'PENDIENTE' && jornada(p.fechaHora) === VIE).map((p) => p.fechaHora.getTime()));
  const recuperado = previo.find((p) => p.estado === 'PENDIENTE' && jornada(p.fechaHora) === VIE);
  await prisma.partido.update({ where: { id: recuperado.id }, data: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true } });
  await canchasOverridesService.setOverrideDia(torneo.id, VIE, 5, JUEVES, { [recuperado.id]: 'Sin cancha activa libre disponible en ese horario' });
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, 2, local(14, 17, 43), VIE);
  const despues = await leerPartidos(torneo.id);
  const idsViernes = new Set(previo.filter((p) => p.estado === 'PENDIENTE' && jornada(p.fechaHora) === VIE).map((p) => p.id));
  const pasan = [];
  for (const p of despues.filter((p) => idsViernes.has(p.id))) {
    assert.ok(p.fechaHora && !p.sinHorarioAsignado);
    if (jornada(p.fechaHora) === VIE) assert.ok(p.fechaHora.getTime() >= proximoViernes, 'Nada antes del próximo pendiente del viernes');
    else {
      pasan.push(p);
      assert.ok(p.fechaHora >= local(14, 12), 'Pase al sábado desde su próximo pendiente, aunque haya huecos antes');
    }
  }
  assert.ok(pasan.length > 0);
  assert.ok(despues.find((p) => p.id === recuperado.id).fechaHora.getTime() >= proximoViernes, 'El pendiente sin horario también respeta el piso');
  for (const p of previo.filter((p) => p.estado === 'FINALIZADO' || jornada(p.fechaHora) === SAB)) {
    assert.deepStrictEqual(fotoHorarios(despues.filter((n) => n.id === p.id)), fotoHorarios([p]), 'Finalizados y sábado intactos');
  }
  verificarSinChoques(despues, 'Piso próximo pendiente');
  console.log(`OK próximo pendiente: viernes iniciado y sábado ${estadoSabado} hasta las 12:00, sin adelantar al próximo pendiente`);
}

async function probarRestauracionConTurnosRetenidos() {
  const org = await prisma.organizador.create({ data: {
    nombre: 'Club Restauración', email: 'restauracion-piso@padel.test', passwordHash: 'x', cantidadCanchas: 6, ...HORARIOS,
  } });
  const torneo = await prisma.torneo.create({ data: {
    nombre: 'Turnos retenidos', slug: 'restauracion-piso', fecha: local(13, 12), estado: 'EN_CURSO', organizadorId: org.id,
  } });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO' } });
  const zona = await prisma.zona.create({ data: { categoriaId: cat.id, nombre: 'Zona A', clasifican: 2 } });
  const registro = {};
  let orden = 0;
  async function partido(actual, cancha, original = undefined, estado = 'PENDIENTE') {
    const ids = [];
    for (let j = 0; j < 2; j++) {
      const p = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: `J${++orden}`, jugador2: 'Compañero', orden } });
      ids.push(p.id);
    }
    const p = await prisma.partido.create({ data: {
      categoriaId: cat.id, zonaId: zona.id, pareja1Id: ids[0], pareja2Id: ids[1], estado,
      fechaHora: actual, canchaNumero: actual ? cancha : null, sinHorarioAsignado: !actual,
    } });
    if (original !== undefined) registro[p.id] = {
      fechaHora: original?.toISOString() ?? null, canchaNumero: original ? cancha : null, sinHorarioAsignado: !original,
    };
    return p;
  }
  const adelanta = await partido(local(13, 20), 1, local(13, 18));
  const conserva = await partido(local(13, 19), 2, local(13, 18));
  const originalPosterior = await partido(local(13, 20, 45), 3, local(13, 21));
  const sinHorario = await partido(null, 4, local(13, 18));
  const sinOriginal = await partido(local(13, 20), 5, null);
  const noEntra = await partido(null, 4, local(13, 23));
  const bloqueadoPorRetenido = await partido(local(13, 22), 3, local(13, 20));
  const evitaRetenido = await partido(local(13, 21), 2, local(13, 18, 45));
  // Único pendiente ajeno al registro: define el próximo a las 19:30, aunque el registro tenga las 19:00.
  await partido(local(13, 19, 30), 6);
  for (let c = 1; c <= 6; c++) await partido(local(13, 23), c, undefined, c === 1 ? 'EN_CURSO' : 'FINALIZADO');
  await canchasOverridesService.setOverrideDia(torneo.id, VIE, 4, JUEVES, {}, null, registro);
  const antes = await leerPartidos(torneo.id);
  await organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, null, local(14, 17, 43), VIE);
  const despues = await leerPartidos(torneo.id);
  const porId = new Map(despues.map((p) => [p.id, p]));
  const inicio = (p) => porId.get(p.id).fechaHora?.getTime() ?? null;
  assert.strictEqual(inicio(adelanta), local(13, 19, 30).getTime(), 'Earliest-fit desde próximo ajeno al registro');
  assert.strictEqual(inicio(conserva), conserva.fechaHora.getTime(), 'No acepta una alternativa posterior ni igual al actual');
  assert.strictEqual(inicio(originalPosterior), originalPosterior.fechaHora.getTime(), 'Ni siquiera el original puede atrasar el actual');
  assert.strictEqual(inicio(sinHorario), local(13, 19, 30).getTime(), 'Sin horario puede tomar un lugar desde el próximo');
  assert.strictEqual(inicio(sinOriginal), sinOriginal.fechaHora.getTime(), 'Original nulo no borra el horario actual');
  assert.strictEqual(inicio(noEntra), null, 'Sin horario y sin lugar sigue sin horario');
  assert.strictEqual(inicio(bloqueadoPorRetenido), local(13, 20, 15).getTime(), 'Una vuelta original bloqueada usa earliest-fit sin invadir el turno retenido');
  assert.strictEqual(porId.get(bloqueadoPorRetenido.id).canchaNumero, 2);
  assert.strictEqual(inicio(evitaRetenido), local(13, 19, 30).getTime(), 'Earliest-fit aprovecha otra cancha libre');
  assert.strictEqual(porId.get(evitaRetenido.id).canchaNumero, 3);
  verificarSinAtrasos(antes, despues);
  verificarSinChoques(despues, 'Restauración con turnos retenidos');
  for (const p of antes.filter((p) => p.estado !== 'PENDIENTE' || !registro[p.id])) {
    assert.deepStrictEqual(despues.find((n) => n.id === p.id), p, 'Finalizados, en curso y fuera del registro intactos');
  }
  assert.strictEqual(await leerRegistro(torneo.id, VIE), null);
  console.log('OK restaurar: próximo excluye registro, earliest-fit, reservas de turnos actuales y originales nulos');
}

async function main() {
  await ensureTestDb();
  await canchasOverridesService.loadFromDb();
  await probarDisponibilidadSoloSinHorario();
  await probarViernesConHuecoPrevio();
  await probarIndependenciaDelReloj();
  await probarJornadasSinEmpezar();
  await probarPisoProximoPendiente('FINALIZADO');
  await probarPisoProximoPendiente('EN_CURSO');
  await probarRestauracionConTurnosRetenidos();
  let { org, torneo } = await crearEscenario();
  const reducir = (canchas, diaKey, ahora) => organizadorService.reprogramarPorReduccionCanchas(org.id, torneo.id, canchas, ahora, diaKey);

  const inicial = await leerPartidos(torneo.id);
  const delViernes = inicial.filter((p) => jornada(p.fechaHora) === VIE);
  let sabadoAntes = inicial.filter((p) => jornada(p.fechaHora) === SAB);
  assert.strictEqual(delViernes.length, 23);

  // ── 1. Viernes 6 → 4 ──────────────────────────────────────────────────────────────────────────────
  await reducir(4, VIE, JUEVES);
  let partidos = await leerPartidos(torneo.id);
  verificarSinAdelantos(inicial, partidos, 'Viernes 6→4');
  const porId = (lista) => new Map(lista.map((p) => [p.id, p]));
  let actuales = porId(partidos);
  const pasaronAlSabado = [];
  for (const original of delViernes) {
    const p = actuales.get(original.id);
    assert.ok(p.fechaHora && !p.sinHorarioAsignado, 'Con estas canchas todo entra entre el viernes y el sábado');
    const inicio = p.fechaHora.getTime();
    if (jornada(p.fechaHora) === VIE) {
      assert.ok(inicio >= original.fechaHora.getTime(), 'Viernes: un partido con horario respeta su horario anterior como piso');
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
  console.log(`OK viernes 6→4: piso por horario previo, cierre a las 00:00 y ${pasaronAlSabado.length} partidos pasan al sábado sin choques`);

  // ── 2. Un partido termina durante la lluvia ───────────────────────────────────────────────────────
  // Uno que la lluvia movió dentro del viernes: puede ocupar el horario original de otros
  const originalDe = new Map(delViernes.map((p) => [p.id, p]));
  const finalizado = partidos.find((p) => originalDe.has(p.id) && jornada(p.fechaHora) === VIE
    && (p.fechaHora.getTime() !== originalDe.get(p.id).fechaHora.getTime() || p.canchaNumero !== originalDe.get(p.id).canchaNumero));
  assert.ok(finalizado, 'Hay un partido que la lluvia movió dentro del viernes');
  await prisma.partido.update({ where: { id: finalizado.id }, data: { estado: 'FINALIZADO', ganadorId: finalizado.pareja1Id } });

  // ── 3. Viernes 4 → 3: el registro de la primera reducción se conserva ─────────────────────────────
  const conCuatroViernes = await leerPartidos(torneo.id);
  await reducir(3, VIE, JUEVES);
  verificarSinAdelantos(conCuatroViernes, await leerPartidos(torneo.id), 'Viernes 4→3');
  assert.deepStrictEqual(await leerRegistro(torneo.id, VIE), registroViernes, 'Una segunda reducción no pisa el registro');
  verificarSinChoques(await leerPartidos(torneo.id), 'Viernes 4→3');
  console.log('OK viernes 4→3: conserva el registro de la primera reducción');

  // ── 4. Restaurar el viernes ───────────────────────────────────────────────────────────────────────
  const antesRestaurar = await leerPartidos(torneo.id);
  await reducir(null, VIE, local(14, 17, 43));
  partidos = await leerPartidos(torneo.id);
  verificarSinAtrasos(antesRestaurar, partidos);
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
    if (p.fechaHora.getTime() === o.fechaHora.getTime() && p.canchaNumero === o.canchaNumero) {
      assert.ok(!chocaConFinalizado(o), 'No se restaura sobre el finalizado');
      volvieron++;
    } else {
      // Un turno retenido también puede bloquear el original: se adelanta si hay lugar o conserva el actual.
      const previo = antesRestaurar.find((m) => m.id === p.id);
      assert.ok(p.fechaHora.getTime() >= o.fechaHora.getTime(), 'Si no puede volver, respeta el horario original como piso');
      if (p.fechaHora.getTime() < previo.fechaHora.getTime()) {
        assert.strictEqual(jornada(p.fechaHora), VIE, 'En su jornada original');
        assert.ok(p.fechaHora.getTime() + DURACION_MS <= CIERRE_VIERNES, 'Antes del cierre del viernes');
      }
      desplazados++;
    }
  }
  assert.ok(desplazados >= 1, 'El finalizado ocupa el horario original de al menos un partido');
  assert.ok(pasaronAlSabado.filter((id) => id !== finalizado.id).every((id) => jornada(actuales.get(id).fechaHora) === VIE
    || actuales.get(id).fechaHora.getTime() === antesRestaurar.find((p) => p.id === id).fechaHora.getTime()),
    'Los que habían pasado al sábado vuelven al viernes o conservan su turno si ya no hay lugar');
  assert.ok(volvieron >= 18, `La mayoría vuelve exacto a su horario (${volvieron})`);
  verificarSinChoques(partidos, 'Restaurar viernes');
  console.log(`OK restaurar viernes: ${volvieron} vuelven al horario y cancha originales; ${desplazados} buscan lugar sin atrasarse ni perder su horario; el finalizado no cambia`);

  // ── 5. Sábado 6 → 4 → 3: cada reducción usa el horario inmediatamente anterior ───────────────────
  // Escenario independiente: la restauración anterior puede conservar un turno del viernes en el sábado.
  ({ org, torneo } = await crearEscenario());
  partidos = await leerPartidos(torneo.id);
  sabadoAntes = partidos.filter((p) => jornada(p.fechaHora) === SAB);
  const antesSabado = partidos;
  await reducir(4, SAB, JUEVES);
  partidos = await leerPartidos(torneo.id);
  verificarSinAdelantos(antesSabado, partidos, 'Sábado 6→4');
  const delSabado = partidos.filter((p) => p.estado === 'PENDIENTE' && p.fechaHora && jornada(p.fechaHora) === SAB);
  assert.deepStrictEqual(delSabado.map((p) => hhmm(p.fechaHora.getTime())).sort(),
    ['08:00', '08:00', '08:00', '08:00', '09:15', '10:00', '10:00', '10:00', '10:30'], 'Sábado: respeta los turnos de las 10:00 aunque haya huecos antes');
  assert.ok(delSabado.every((p) => p.canchaNumero <= 4));
  verificarSinChoques(partidos, 'Sábado 6→4');
  const registroSabado = await leerRegistro(torneo.id, SAB);
  const conCuatroSabado = partidos;
  assert.ok(delSabado.some((p) => p.fechaHora > sabadoAntes.find((s) => s.id === p.id).fechaHora), 'La primera reducción atrasa partidos');
  await reducir(3, SAB, JUEVES);
  partidos = await leerPartidos(torneo.id);
  verificarSinAdelantos(conCuatroSabado, partidos, 'Sábado 4→3');
  verificarSinChoques(partidos, 'Sábado 4→3');
  assert.deepStrictEqual(await leerRegistro(torneo.id, SAB), registroSabado, 'El registro del sábado tampoco se pisa');
  await reducir(null, SAB, JUEVES);
  partidos = await leerPartidos(torneo.id);
  actuales = porId(partidos);
  for (const s of sabadoAntes) {
    assert.strictEqual(actuales.get(s.id).fechaHora.getTime(), s.fechaHora.getTime(), 'Restaurar el sábado devuelve su horario');
  }
  console.log('OK sábado 6→4→3: no se adelanta respecto del horario previo a cada reducción; restaurar lo devuelve');

  // ── 6. Sábado y viernes usan el próximo pendiente aunque el reloj marque más tarde ───────────────
  const antesSabadoConReloj = partidos;
  const sabado905 = local(14, 9, 5);
  await reducir(4, SAB, sabado905);
  partidos = await leerPartidos(torneo.id);
  const pendientesSab = partidos.filter((p) => p.estado === 'PENDIENTE' && p.fechaHora && jornada(p.fechaHora) === SAB);
  assert.strictEqual(Math.min(...pendientesSab.map((p) => p.fechaHora.getTime())), local(14, 8).getTime(), 'Sábado: se parte del próximo pendiente a las 08:00');
  verificarSinAdelantos(antesSabadoConReloj, partidos, 'Sábado con reloj adelantado');
  await reducir(null, SAB, sabado905);
  partidos = await leerPartidos(torneo.id);
  const tras = partidos.filter((p) => p.estado === 'PENDIENTE' && p.fechaHora && jornada(p.fechaHora) === SAB);
  assert.strictEqual(Math.min(...tras.map((p) => p.fechaHora.getTime())), local(14, 8).getTime());
  verificarSinChoques(partidos, 'Sábado con próximo pendiente');

  const viernes1940 = local(13, 19, 40);
  await reducir(4, VIE, viernes1940);
  partidos = await leerPartidos(torneo.id);
  const pendientesVie = partidos.filter((p) => p.estado === 'PENDIENTE' && p.fechaHora && jornada(p.fechaHora) === VIE);
  assert.ok(pendientesVie.length > 0);
  assert.strictEqual(Math.min(...pendientesVie.map((p) => p.fechaHora.getTime())), local(13, 18).getTime(), 'Viernes: el reloj no reemplaza al próximo pendiente');
  verificarSinChoques(partidos, 'Viernes con próximo pendiente');
  const antesUltimaRestauracion = partidos;
  await reducir(null, VIE, viernes1940);
  partidos = await leerPartidos(torneo.id);
  verificarSinAtrasos(antesUltimaRestauracion, partidos);
  verificarSinChoques(partidos, 'Restaurar viernes con próximo pendiente');
  console.log('OK casos del viejo piso de hora actual actualizados a próximo pendiente');

  console.log('\nPASS test-lluvia-horario-original');
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(0)))
  .catch((e) => {
    console.error(e);
    prisma.$disconnect().finally(() => process.exit(1));
  });
