import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { ChevronRight, Clock, Loader2, AlertTriangle, Star, X } from 'lucide-react';
import { formatDiaHorario, minutosCronologicosJornada, formatSlotCalendario } from '../utils/dateUtils';
import { rankearSlotsParaPartido } from '../utils/rankingSlots';
import GrillaHorariosPartido from './GrillaHorariosPartido';
import { describirHorarioPareja, detallePorPareja } from './grillaHorarios';

const HORA_INICIO_NOCHE_DIECISEISAVOS = 18; // 18:00hs: inicio de franja nocturna post-zonas para Dieciseisavos
const FASE_POR_RONDA = { 64: 'Treintaidosavos', 32: 'Dieciseisavos', 16: 'Octavos', 8: 'Cuartos', 4: 'Semifinal', 2: 'Final' };
const diasCompletos = (texto) => texto.replace(/\b(vie|sáb|dom|lun)\b/g,
  (dia) => ({ vie: 'viernes', sáb: 'sábado', dom: 'domingo', lun: 'lunes' })[dia]);

/** Horario cargado de una pareja a partir de sus inicios ("Viernes-18:00"): ventanas por jornada, de 75 min. */
function horarioDeSlots(slotIds) {
  if (!slotIds.length) return { cargado: false, ventanas: [] };
  const orden = { Viernes: 0, Sabado: 1, Domingo: 2 };
  const inicios = slotIds.map((id) => { const [dia, hora] = id.split('-'); return { dia, min: minutosCronologicosJornada(hora) }; })
    .sort((a, b) => (orden[a.dia] ?? 3) - (orden[b.dia] ?? 3) || a.min - b.min);
  const ventanas = [];
  for (const i of inicios) {
    const ultima = ventanas.at(-1);
    if (ultima && ultima.dia === i.dia && i.min <= ultima.fin) ultima.fin = Math.max(ultima.fin, i.min + 75);
    else ventanas.push({ dia: i.dia, desde: i.min, fin: i.min + 75 });
  }
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { cargado: true, ventanas: ventanas.map((v) => ({ dia: v.dia, desde: hhmm(v.desde), hasta: hhmm(v.fin) })) };
}

/** Lo que se le pide a una pareja para un horario, desde la distancia del ranking (minutos con signo; 999 = otro día). */
function ampliacionDesdeDistancia(parejaId, dist) {
  if (dist === 999) return { parejaId, diaNuevo: true, minutosAntes: 0, minutosDespues: 0 };
  return { parejaId, diaNuevo: false, minutosAntes: dist < 0 ? -dist : 0, minutosDespues: dist > 0 ? dist : 0 };
}

export default function AsignarHorarioModal({ isOpen, partido, torneoId, onClose, onAssigned }) {
  const [loadingCanchas, setLoadingCanchas] = useState(false);
  const [dataCanchas, setDataCanchas] = useState(null);
  const [guardandoSlotId, setGuardandoSlotId] = useState(null);
  const [error, setError] = useState('');
  const [verTodos, setVerTodos] = useState(false);
  const [seleccion, setSeleccion] = useState(null);
  const [advertenciasAsignacion, setAdvertenciasAsignacion] = useState(null);

  useEffect(() => {
    if (isOpen && torneoId) {
      cargarCanchasDisponibles();
      setGuardandoSlotId(null);
      setError('');
      setVerTodos(false);
      setSeleccion(null);
      setAdvertenciasAsignacion(null);
    }
  }, [isOpen, torneoId, partido]);

  const cargarCanchasDisponibles = async () => {
    setLoadingCanchas(true);
    setError('');
    try {
      const url = partido?.fechaHora
        ? `/torneos/${torneoId}/canchas-disponibles?ignorePartidoId=${partido.id}`
        : `/torneos/${torneoId}/canchas-disponibles`;
      const res = await api.get(url);
      setDataCanchas(res);
    } catch (err) {
      setError(err.message || 'No pudimos buscar los horarios.');
    } finally {
      setLoadingCanchas(false);
    }
  };

  if (!isOpen || !partido) return null;

  const slotsP1 = (partido.pareja1?.slotsSeleccionados || []).map((s) => s.slotId);
  const slotsP2 = (partido.pareja2?.slotsSeleccionados || []).map((s) => s.slotId);

  const rawSlots = dataCanchas?.slots || [];

  // Discriminación contextual por tipo de partido (Zona vs Eliminatoria vs Dieciseisavos)
  const esPartidoZona = Boolean(partido.zonaId || partido.zona);
  const esPartidoEliminatoria = Boolean(partido.faseEliminatoriaId || partido.faseEliminatoria);
  const esDieciseisavos =
    esPartidoEliminatoria &&
    Boolean(
      (partido.faseEliminatoria?.ronda && partido.faseEliminatoria.ronda >= 32) ||
      partido.faseEliminatoria?.nombre?.toLowerCase().includes('dieciseisavos')
    );
  const esSinParejasDefinidas = !partido.pareja1Id || !partido.pareja2Id;

  const esSlotPermitidoPorContexto = (s) => {
    if (esPartidoZona) {
      // Partidos de zona: estrictamente Viernes y Sábado
      return s.dia === 'Viernes' || s.dia === 'Sabado';
    }
    if (esDieciseisavos) {
      // Dieciseisavos: solo Sábado noche (a partir de 18:00hs, incluida la trasnoche de la jornada del sábado)
      if (s.dia === 'Sabado') {
        return minutosCronologicosJornada(s.hora) >= HORA_INICIO_NOCHE_DIECISEISAVOS * 60;
      }
      return false;
    }
    if (esPartidoEliminatoria) {
      // Eliminatorias regulares (Octavos a Final): estrictamente Domingo
      return s.dia === 'Domingo';
    }
    return true;
  };

  const coincideConHorarioActual = (s) => {
    if (!partido.fechaHora) return false;
    if (s.fechaIso) {
      const diff = Math.abs(new Date(s.fechaIso).getTime() - new Date(partido.fechaHora).getTime());
      if (diff < 60000) return true;
    }
    const fechaActualStr = formatDiaHorario(partido.fechaHora);
    const normalizar = (str) =>
      (str || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
    return normalizar(fechaActualStr) === normalizar(formatSlotCalendario(s.slotId));
  };

  // FILTRADO ESTRICTO DE FACTIBILIDAD Y CONTEXTO:
  // 1. Excluir la cancha que el propio partido ya tiene asignada a esa misma hora (no ofrecer lo que ya tiene)
  // 2. Hay al menos una cancha libre
  // 3. Corresponde al día permitido según el contexto del partido
  // 4. Ninguna de las 2 parejas tiene otro partido en simultáneo
  const slotsValidos = rawSlots
    .map((s) => {
      const esMismoHorario = coincideConHorarioActual(s);
      if (esMismoHorario) {
        const canchasLibresAjustadas = partido.canchaNumero
          ? (s.canchasLibres || []).filter((c) => c !== partido.canchaNumero)
          : [];
        return {
          ...s,
          canchasLibres: canchasLibresAjustadas,
        };
      }
      return s;
    })
    .filter((s) => {
      if (!s.canchasLibres || s.canchasLibres.length === 0) return false;
      if (!esSlotPermitidoPorContexto(s)) return false;
      const p1Ocupada = partido.pareja1Id && (s.parejasOcupadasIds || []).includes(partido.pareja1Id);
      const p2Ocupada = partido.pareja2Id && (s.parejasOcupadasIds || []).includes(partido.pareja2Id);
      if (p1Ocupada || p2Ocupada) return false;
      return true;
    });

  // Ranking inteligente idéntico a preCheck (solo necesario en fase de zonas con parejas definidas)
  const rankedSlots = (esPartidoEliminatoria || esSinParejasDefinidas) ? [] : rankearSlotsParaPartido(slotsValidos, slotsP1, slotsP2);

  const p1Nombre = partido.pareja1 ? `${partido.pareja1.jugador1} / ${partido.pareja1.jugador2}` : 'Pareja 1';
  const p2Nombre = partido.pareja2 ? `${partido.pareja2.jugador1} / ${partido.pareja2.jugador2}` : 'Pareja 2';
  const conParejas = !esPartidoEliminatoria && !esSinParejasDefinidas;

  // Texto del cruce con fallbacks honestos para eliminatorias y zonas
  let cruceTexto = '';
  if (partido.pareja1 && partido.pareja2) {
    cruceTexto = `${p1Nombre} vs ${p2Nombre}`;
  } else if (partido.pareja1 || partido.pareja2) {
    const definida = partido.pareja1 ? p1Nombre : p2Nombre;
    const pendiente = partido.pareja1
      ? (partido.origenPareja2 || 'Esperando clasificado...')
      : (partido.origenPareja1 || 'Esperando clasificado...');
    cruceTexto = `${definida} vs ${pendiente}`;
  } else if (partido.origenPareja1 || partido.origenPareja2) {
    cruceTexto = `${partido.origenPareja1 || 'Esperando...'} vs ${partido.origenPareja2 || 'Esperando...'}`;
  } else {
    cruceTexto = esPartidoEliminatoria ? 'Cruce pendiente de definir' : 'Pareja 1 vs Pareja 2';
  }

  const contextoNombre = esPartidoEliminatoria
    ? (FASE_POR_RONDA[partido.faseEliminatoria?.ronda] || partido.faseEliminatoria?.nombre || 'Cuadro')
    : (partido.zona?.nombre || 'Zona');

  // Nombres de las parejas del partido y de su zona (para "Partidos de la zona").
  const nombres = new Map();
  const sumarNombre = (pareja) => { if (pareja?.id) nombres.set(pareja.id, `${pareja.jugador1} / ${pareja.jugador2}`); };
  sumarNombre(partido.pareja1);
  sumarNombre(partido.pareja2);
  for (const zp of partido.zona?.partidos || []) { sumarNombre(zp.pareja1); sumarNombre(zp.pareja2); }

  // Horario de cada pareja, como en el pre-check.
  const textoHorarios = conParejas ? [
    { nombre: p1Nombre, slots: slotsP1 }, { nombre: p2Nombre, slots: slotsP2 },
  ].map(({ nombre, slots }) => {
    const horario = describirHorarioPareja(horarioDeSlots(slots));
    return horario ? `${nombre} pueden ${diasCompletos(horario)}` : `${nombre}, sin horario cargado`;
  }).join(' · ') : null;

  // Los otros partidos de la zona, por horario y sin cancha.
  const otrosPartidos = conParejas ? (partido.zona?.partidos || [])
    .filter((zp) => zp.id !== partido.id && !zp.esBye)
    .map((zp) => {
      const conHorario = Boolean(zp.fechaHora && zp.canchaNumero && !zp.sinHorarioAsignado);
      return { ...zp, pareja1Id: zp.pareja1?.id || null, pareja2Id: zp.pareja2?.id || null,
        fechaHora: conHorario ? zp.fechaHora : null, canchaNumero: conHorario ? zp.canchaNumero : null };
    })
    .sort((a, b) => (a.fechaHora ? 0 : 1) - (b.fechaHora ? 0 : 1) || +new Date(a.fechaHora || 0) - +new Date(b.fechaHora || 0) ||
      (a.posicionEnRonda || 0) - (b.posicionEnRonda || 0)) : [];

  // Opciones con la forma de la grilla del pre-check. En zona, el orden y el recomendado son los del ranking;
  // una pareja sin horario cargado puede en cualquier horario, así que no se le pide nada.
  const opciones = conParejas
    ? rankedSlots.map((s) => {
      const ampliacionPorPareja = [
        s.addToP1 && slotsP1.length > 0 && ampliacionDesdeDistancia(partido.pareja1Id, s.distP1),
        s.addToP2 && slotsP2.length > 0 && ampliacionDesdeDistancia(partido.pareja2Id, s.distP2),
      ].filter(Boolean);
      const parejasAAmpliar = ampliacionPorPareja.map((a) => a.parejaId);
      return { ...s, clave: s.slotId, fechaHora: s.fechaIso || '', ampliacionPorPareja, parejasAAmpliar,
        estado: parejasAAmpliar.length === 0 ? 'ENTRA' : parejasAAmpliar.length === 1 ? 'PEDIR_1' : 'PEDIR_VARIAS' };
    })
    : slotsValidos.map((s) => ({ ...s, clave: s.slotId, fechaHora: s.fechaIso || '', estado: 'ENTRA', parejasAAmpliar: [], ampliacionPorPareja: [] }))
      .sort((a, b) => a.fechaHora.localeCompare(b.fechaHora));
  const recomendado = opciones[0] || null;
  const pedido = (opcion) => {
    if (!conParejas) return 'horario libre';
    if (!opcion.parejasAAmpliar.length) return 'entra en el horario de las dos parejas';
    return detallePorPareja(opcion, nombres).map((d) => `${d.nombre}: ${diasCompletos(d.texto)}`).join(' · ');
  };

  const handleCerrarModal = () => {
    if (advertenciasAsignacion) {
      if (onAssigned) onAssigned(advertenciasAsignacion.res);
      onClose();
    } else {
      onClose();
    }
  };

  const handleAsignar = async (opt) => {
    if (!opt || guardandoSlotId) return;
    setGuardandoSlotId(opt.slotId);
    setError('');

    // Siempre asigna la primera cancha libre por orden numérico ascendente
    const cancha = opt.canchasLibres?.[0];
    if (!cancha) {
      setError('No hay cancha libre en este horario.');
      setGuardandoSlotId(null);
      return;
    }

    try {
      const res = await api.put(`/partidos/${partido.id}/asignar-horario-manual`, {
        slotId: opt.slotId,
        canchaNumero: cancha,
      });
      if (res?.advertencias && res.advertencias.length > 0) {
        setAdvertenciasAsignacion({ advertencias: res.advertencias, res });
      } else {
        if (onAssigned) onAssigned(res);
        onClose();
      }
    } catch (err) {
      setError(err.message || 'No pudimos asignar el horario.');
    } finally {
      setGuardandoSlotId(null);
    }
  };

  const ocupado = Boolean(guardandoSlotId);

  return (
    <div
      className="pm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !guardandoSlotId) {
          handleCerrarModal();
        }
      }}
    >
      <div className="pm-modal pm-schedule" role="dialog" aria-modal="true" aria-labelledby="pm-schedule-title">
        <div className="pm-header">
          <div>
            <h3 id="pm-schedule-title" className="pm-title">{partido.fechaHora ? 'Cambiar horario' : 'Asignar horario'}</h3>
            <span className="pm-muted">{partido.categoria?.nombre} · {contextoNombre}</span>
          </div>
          <button type="button" onClick={handleCerrarModal} className="pm-button pm-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="pm-body">
          <div className="pm-match-info">
            <div className="pm-strong">{cruceTexto}</div>
            {partido.fechaHora && (
              <p className="pm-current-time">
                <Clock size={12} className="pm-brand-icon" aria-hidden="true" />
                <span>Actualmente: {formatDiaHorario(partido.fechaHora).toLowerCase()}</span>
              </p>
            )}
            {textoHorarios && <p className="pc-horarios-parejas">{textoHorarios}</p>}
            {otrosPartidos.length > 0 && (
              <section className="pc-propuesta-partidos" aria-label="Partidos de la zona">
                <h5 className="pc-propuesta-partidos-title">Partidos de la zona</h5>
                <ul className="pc-propuesta-partidos-list">
                  {otrosPartidos.map((zp) => (
                    <li key={zp.id} className="pc-propuesta-partido">
                      <span className="pc-zona-fila">
                        <span className="pc-zona-rivales">
                          {zp.pareja1Id && zp.pareja2Id
                            ? `${nombres.get(zp.pareja1Id) || 'Pareja 1'} vs ${nombres.get(zp.pareja2Id) || 'Pareja 2'}`
                            : zp.origen || 'Partido por definir'}
                        </span>
                        {zp.fechaHora ? (
                          <>
                            <span className="pc-zona-separador" aria-hidden="true">{'\u00a0·'}</span>{' '}
                            <span className="pc-zona-dato"><time dateTime={zp.fechaHora}>{formatDiaHorario(zp.fechaHora).toLowerCase()}</time></span>
                          </>
                        ) : <>{' '}<span className="pc-zona-badge">sin horario</span></>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {error && <div className="pm-alert" role="alert">{error}</div>}

          {advertenciasAsignacion ? (
            <div className="pm-alert">
              <div className="pm-alert-heading">
                <AlertTriangle size={18} className="pm-icon" />
                <strong className="pm-strong">Horario asignado con advertencias</strong>
              </div>
              <ul className="pm-warning-list">
                {advertenciasAsignacion.advertencias.map((adv, idx) => (
                  <li key={idx} className="pm-warning-item">{adv.mensaje}</li>
                ))}
              </ul>
            </div>
          ) : loadingCanchas ? (
            <div className="pm-loading" role="status">
              <Loader2 size={18} className="pm-spinner" /> Buscando horarios…
            </div>
          ) : !recomendado ? (
            <div className="pm-alert pm-empty">
              <AlertTriangle size={22} className="pm-icon" />
              <div>
                <strong className="pm-strong">No hay horarios libres para este partido</strong>
                <p className="pm-alert-copy">
                  {esPartidoEliminatoria
                    ? 'Las canchas están ocupadas en todos los horarios de esta fase.'
                    : 'En todos los horarios las canchas están ocupadas o alguna de las dos parejas ya juega otro partido.'}
                </p>
                {!esPartidoEliminatoria && (
                  <div className="pm-block">
                    <Link
                      to={`/admin/torneos/${torneoId}/categorias/${partido.categoriaId || partido.categoria?.id}/parejas`}
                      className="pm-inline-link"
                    >
                      Ir a las parejas de {partido.categoria?.nombre || 'la categoría'} →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="pm-asignar">
              <div className="pm-asignar-recomendado">
                <p className="pc-horarios-recomendado-texto">
                  <Star size={16} aria-hidden="true" />
                  <span className="pc-horarios-recomendado-cuerpo">
                    <span><strong>Recomendado:</strong> {formatSlotCalendario(recomendado.slotId).toLowerCase()}
                      {conParejas && recomendado.estado === 'ENTRA' && ' · entra en el horario de las dos parejas'}</span>
                    {conParejas && recomendado.estado !== 'ENTRA' && (
                      <span className="pc-horarios-recomendado-detalle">{pedido(recomendado)}</span>
                    )}
                  </span>
                </p>
                <button type="button" className="pm-button pm-primary" disabled={ocupado} onClick={() => handleAsignar(recomendado)}>
                  {guardandoSlotId === recomendado.slotId
                    ? <><Loader2 size={14} className="pm-spinner" aria-hidden="true" /> Asignando…</>
                    : 'Asignar este horario'}
                </button>
              </div>
              <button type="button" className="pc-horarios-plegar pc-horarios-ver-todos" aria-expanded={verTodos}
                aria-controls="pm-asignar-grilla" disabled={ocupado} onClick={() => { setVerTodos((v) => !v); setSeleccion(null); }}>
                <ChevronRight size={14} aria-hidden="true" className={verTodos ? 'is-open' : ''} />
                <span>Ver todos los horarios ({opciones.length})</span>
              </button>
              {verTodos && (
                <div id="pm-asignar-grilla">
                  <GrillaHorariosPartido opciones={opciones} seleccion={seleccion} onSeleccion={setSeleccion} describir={pedido}
                    nombres={nombres} fijando={ocupado} onCambioDia={() => setSeleccion(null)}
                    recomendadoClave={recomendado.clave} sinRecomendado soloDiasConHorarios sinPlegar diasCompletos />
                  {seleccion && (
                    <div className="pm-asignar-confirmacion" role="group" aria-label="Confirmar horario">
                      <p className="pc-manual-copy" role="status" aria-atomic="true">{formatSlotCalendario(seleccion.slotId).toLowerCase()} · {pedido(seleccion)}</p>
                      <div className="pc-manual-actions">
                        <button type="button" className="pc-manual-button" disabled={ocupado} onClick={() => handleAsignar(seleccion)}>
                          {guardandoSlotId === seleccion.slotId ? 'Asignando…' : 'Confirmar'}
                        </button>
                        <button type="button" className="pc-manual-button" disabled={ocupado} onClick={() => setSeleccion(null)}>Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="pm-footer">
          {advertenciasAsignacion ? (
            <button type="button" className="pm-button pm-primary" onClick={handleCerrarModal}>Entendido</button>
          ) : (
            <button type="button" className="pm-button" onClick={handleCerrarModal} disabled={ocupado}>Cerrar</button>
          )}
        </div>
      </div>
    </div>
  );
}
