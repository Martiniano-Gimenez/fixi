import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Clock, Star, Users, ChevronDown, ChevronUp, Loader2, AlertTriangle, X } from 'lucide-react';
import { formatAjusteTiempo, formatDiaHorario, minutosCronologicosJornada, getSlotCalendario, formatSlotCalendario } from '../utils/dateUtils';
import { rankearSlotsParaPartido } from '../utils/rankingSlots';

const HORA_INICIO_NOCHE_DIECISEISAVOS = 18; // 18:00hs: inicio de franja nocturna post-zonas para Dieciseisavos

export default function AsignarHorarioModal({ isOpen, partido, torneoId, onClose, onAssigned }) {
  const [loadingCanchas, setLoadingCanchas] = useState(false);
  const [dataCanchas, setDataCanchas] = useState(null);
  const [guardandoSlotId, setGuardandoSlotId] = useState(null);
  const [error, setError] = useState('');
  const [showAlternativas, setShowAlternativas] = useState(false);
  const [showTodosViables, setShowTodosViables] = useState(false);
  const [advertenciasAsignacion, setAdvertenciasAsignacion] = useState(null);

  const [expandedSlotId, setExpandedSlotId] = useState(null);

  useEffect(() => {
    if (isOpen && torneoId) {
      cargarCanchasDisponibles();
      setGuardandoSlotId(null);
      setError('');
      setShowAlternativas(false);
      setShowTodosViables(false);
      setExpandedSlotId(null);
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
      setError(err.message || 'Error al cargar canchas disponibles.');
    } finally {
      setLoadingCanchas(false);
    }
  };

  if (!isOpen || !partido) return null;

  const slotsP1 = (partido.pareja1?.slotsSeleccionados || []).map((s) => s.slotId);
  const slotsP2 = (partido.pareja2?.slotsSeleccionados || []).map((s) => s.slotId);
  const slotsEnComunOriginales = slotsP1.filter((s) => slotsP2.includes(s));

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
        .replace(/[\u0300-\u036f]/g, '')
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

  const slotsEnComunDisponibles = slotsEnComunOriginales.filter((id) =>
    slotsValidos.some((s) => s.slotId === id)
  );

  // Ranking inteligente idéntico a preCheck (solo necesario en fase de zonas con parejas definidas)
  const rankedSlots = (esPartidoEliminatoria || esSinParejasDefinidas) ? [] : rankearSlotsParaPartido(slotsValidos, slotsP1, slotsP2);

  const heroOption = rankedSlots[0];
  const alternativas = rankedSlots.slice(1, 6);
  const restoAlternativasCount = Math.max(0, rankedSlots.length - 1);

  const viernesNormales = slotsValidos.filter((s) => s.dia === 'Viernes' && !getSlotCalendario(s.slotId)?.esMadrugada);
  const viernesMadrugada = slotsValidos.filter((s) => s.dia === 'Viernes' && getSlotCalendario(s.slotId)?.esMadrugada);
  const sabadoNormales = slotsValidos.filter((s) => s.dia === 'Sabado' && !getSlotCalendario(s.slotId)?.esMadrugada);
  const sabadoMadrugada = slotsValidos.filter((s) => s.dia === 'Sabado' && getSlotCalendario(s.slotId)?.esMadrugada);
  const domingoViables = slotsValidos.filter((s) => s.dia === 'Domingo');

  const p1Nombre = partido.pareja1 ? `${partido.pareja1.jugador1} / ${partido.pareja1.jugador2}` : 'Pareja 1';
  const p2Nombre = partido.pareja2 ? `${partido.pareja2.jugador1} / ${partido.pareja2.jugador2}` : 'Pareja 2';

  // Texto del cruce con fallbacks honestos para eliminatorias y zonas
  let cruceTexto = '';
  if (partido.pareja1 && partido.pareja2) {
    cruceTexto = `${partido.pareja1.jugador1} / ${partido.pareja1.jugador2} vs ${partido.pareja2.jugador1} / ${partido.pareja2.jugador2}`;
  } else if (partido.pareja1 || partido.pareja2) {
    const definida = partido.pareja1
      ? `${partido.pareja1.jugador1} / ${partido.pareja1.jugador2}`
      : `${partido.pareja2.jugador1} / ${partido.pareja2.jugador2}`;
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
    ? (partido.faseEliminatoria?.nombre || (partido.posicionEnRonda ? `Partido #${partido.posicionEnRonda}` : 'Playoffs'))
    : (partido.zona?.nombre || 'Zona');

  const agruparSlotsEnBloques = (slots) => {
    if (!slots || slots.length === 0) return [];
    const getTimeMs = (s) => (s.fechaIso ? new Date(s.fechaIso).getTime() : minutosCronologicosJornada(s.hora));
    const sorted = [...slots].sort((a, b) => getTimeMs(a) - getTimeMs(b));
    const bloques = [];
    let bloqueActual = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const diff =
        curr.fechaIso && prev.fechaIso
          ? (new Date(curr.fechaIso).getTime() - new Date(prev.fechaIso).getTime()) / (60 * 1000)
          : minutosCronologicosJornada(curr.hora) - minutosCronologicosJornada(prev.hora);

      // Salto discontinuo si la diferencia entre inicios de turno supera 90 minutos
      if (diff > 90) {
        bloques.push(bloqueActual);
        bloqueActual = [curr];
      } else {
        bloqueActual.push(curr);
      }
    }
    bloques.push(bloqueActual);
    return bloques;
  };

  const renderSlotChip = (s) => {
    const isApplying = guardandoSlotId === s.slotId;

    return (
      <button
        key={s.slotId}
        type="button"
        disabled={Boolean(guardandoSlotId)}

        className="pm-button pm-slot"
        onClick={() => handleAsignar(s)}
        title={`Asignar ${formatSlotCalendario(s.slotId)} (${s.canchasLibres?.length || 0} canchas libres)`}
      >
        {isApplying ? (
          <>
            <Loader2 size={10} className="pm-spinner" /> {s.hora}
          </>
        ) : (
          `${s.hora} · Cancha ${s.canchasLibres[0]}`
        )}
      </button>
    );
  };

  const renderDiaBloques = (diaNombre, slots) => {
    if (!slots || slots.length === 0) return null;
    const bloques = agruparSlotsEnBloques(slots);

    return (
      <div className="pm-day-block">
        <div className="pm-day-label">
          {diaNombre}:
        </div>
        <div className="pm-stack">
          {bloques.map((bloque, bIdx) => (
            <div key={bIdx} className="pm-stack">
              {bIdx > 0 && (
                <div
                  className="pm-block-divider"
                />
              )}
              <div className="pm-slot-grid">
                {bloque.map(renderSlotChip)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
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
      setError('No hay cancha libre disponible para este horario.');
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
      setError(err.message || 'Error al asignar horario y cancha.');
    } finally {
      setGuardandoSlotId(null);
    }
  };

  const renderOptionRow = (opt, isHero = false) => {
    const isThisApplying = guardandoSlotId === opt.slotId;
    const isExpanded = expandedSlotId === opt.slotId;
    const isEstrellaMutua = !opt.addToP1 && !opt.addToP2;
    const isCasiEstrellaDoble = opt.addToP1 && opt.addToP2;
    const isEstrellaClasica = !isEstrellaMutua && !isCasiEstrellaDoble;

    let textDetails = null;
    if (isCasiEstrellaDoble) {
      textDetails = `${p1Nombre} ${formatAjusteTiempo(opt.distP1)} · ${p2Nombre} ${formatAjusteTiempo(opt.distP2)}`;
    } else if (isEstrellaClasica) {
      const parejaQueEstira = opt.addToP1 ? p1Nombre : p2Nombre;
      const distQueEstira = opt.addToP1 ? opt.distP1 : opt.distP2;
      textDetails = `${parejaQueEstira} ${formatAjusteTiempo(distQueEstira)}`;
    } else if (isEstrellaMutua) {
      textDetails = 'Dentro de la disponibilidad original de ambas parejas';
    }

    return (
      <div
        key={opt.slotId}
        onClick={() => setExpandedSlotId((prev) => (prev === opt.slotId ? null : opt.slotId))}
        className={`pm-option${isHero ? ' is-hero' : ''}`}
      >
        <div
          className="pm-option-row"
        >
          <div
            className="pm-option-info"
          >
            {isCasiEstrellaDoble ? (
              <Users size={14} className="pm-brand-icon" />
            ) : (
              <Star size={14} className="pm-brand-icon" />
            )}
            <strong className="pm-strong">
              {formatSlotCalendario(opt.slotId)}
            </strong>
            <span className="pm-muted">
              Cancha {opt.canchasLibres[0]} · {opt.canchasLibres.length} libres
            </span>
            <ChevronDown
              size={12}
              className={`pm-chevron${isExpanded ? ' is-expanded' : ''}`}
            />
          </div>

          <div className="pm-option-action">
            <button
              type="button"

              disabled={Boolean(guardandoSlotId)}
              className={`pm-button${isHero ? ' pm-primary' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                handleAsignar(opt);
              }}
            >
              {isThisApplying ? (
                <>
                  <Loader2 size={11} className="pm-spinner" /> Asignando…
                </>
              ) : (
                'Asignar'
              )}
            </button>
          </div>
        </div>

        {/* Detalle desplegable con disclosure progresivo */}
        {isExpanded && textDetails && (
          <div
            className="pm-option-details"
          >
            {textDetails}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="pm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !guardandoSlotId) {
          handleCerrarModal();
        }
      }}
    >
      <div className="pm-modal pm-schedule" role="dialog" aria-modal="true" aria-label="Horario y cancha">
        {/* Header */}
        <div className="pm-header">
          <div>
            <h3 className="pm-title">
              {partido.fechaHora ? 'Reprogramar horario y cancha' : 'Asignar horario y cancha libre'}
            </h3>
            <span className="pm-muted">
              {partido.categoria?.nombre} · {contextoNombre}
            </span>
          </div>
          <button type="button" onClick={handleCerrarModal} className="pm-button pm-close" aria-label="Cerrar horario y cancha">
            <X size={18} />
          </button>
        </div>

        <div className="pm-body">
        {/* Info del partido */}
        <div className="pm-match-info">
          <div className="pm-strong">
            {cruceTexto}
          </div>

          <div className="pm-match-meta">
            {partido.fechaHora && (
              <div
                className="pm-current-time"
              >
                <Clock size={12} className="pm-brand-icon" />
                <span>
                  <strong className="pm-strong">Actualmente:</strong>{' '}
                  <span className="pm-strong">
                    {formatDiaHorario(partido.fechaHora)}
                    {partido.canchaNumero && ` · Cancha ${partido.canchaNumero}`}
                  </span>
                </span>
              </div>
            )}

            {!esPartidoEliminatoria && !esSinParejasDefinidas && (
              slotsEnComunOriginales.length > 0 && slotsEnComunDisponibles.length === 0 ? (
                <div
                  className="pm-alert pm-match-notice"
                  title="Coincidían en disponibilidad pero las canchas están 100% ocupadas en esos turnos"
                >
                  <AlertTriangle size={12} className="pm-icon" />
                  <span>Coincidían en {slotsEnComunOriginales.length} {slotsEnComunOriginales.length === 1 ? 'turno' : 'turnos'} pero sin canchas libres</span>
                </div>
              ) : slotsEnComunOriginales.length === 0 ? (
                <div
                  className="pm-alert pm-match-notice"
                  title="Ambas parejas no tienen ninguna ventana horaria en común declarada"
                >
                  <Users size={12} className="pm-icon" />
                  <span>Sin coincidencia horaria directa</span>
                </div>
              ) : null
            )}

            {esSinParejasDefinidas && (
              <div
                className="pm-alert pm-match-notice"
              >
                <Clock size={12} className="pm-icon" />
                <span>Cruce pendiente de resultados previos. Podés fijar o cambiar su horario y cancha anticipadamente.</span>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="pm-alert">
            {error}
          </div>
        )}

        {/* Contenido principal */}
        {advertenciasAsignacion ? (
          <div className="pm-stack">
            <div
              className="pm-alert"
            >
              <div className="pm-alert-heading">
                <AlertTriangle size={18} className="pm-icon" />
                <strong className="pm-strong">
                  Horario asignado con advertencias
                </strong>
              </div>
              <ul className="pm-warning-list">
                {advertenciasAsignacion.advertencias.map((adv, idx) => (
                  <li key={idx} className="pm-warning-item">
                    {adv.mensaje}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="pm-stack">
          {loadingCanchas ? (
            <div className="pm-loading">
              <Loader2 size={18} className="pm-spinner" /> Consultando canchas y disponibilidad en tiempo real...
            </div>
          ) : slotsValidos.length === 0 ? (
            <div
              className="pm-alert pm-empty"
            >
              <AlertTriangle size={22} className="pm-icon" />
              <div>
                <strong className="pm-strong">
                  {esPartidoEliminatoria
                    ? 'No hay turnos con cancha disponible para este cruce de playoffs'
                    : 'No hay turnos disponibles donde haya cancha libre y ambas parejas no estén jugando'}
                </strong>
                <p className="pm-alert-copy">
                  {esPartidoEliminatoria
                    ? 'Todas las canchas del club están 100% ocupadas en los horarios correspondientes a esta fase.'
                    : 'En todos los turnos del torneo las canchas están 100% ocupadas por otros partidos o alguna de las dos parejas ya tiene un partido asignado en simultáneo.'}
                </p>
                {!esPartidoEliminatoria && (
                  <div className="pm-block">
                    <Link
                      to={`/admin/torneos/${torneoId}/categorias/${partido.categoriaId || partido.categoria?.id}/parejas`}
                      className="pm-inline-link"
                    >
                      Ir a Gestionar Parejas de {partido.categoria?.nombre || 'la Categoría'} →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ) : (esPartidoEliminatoria || esSinParejasDefinidas) ? (
            /* Vista simplificada para Eliminatorias / Bracket o Partidos sin parejas confirmadas: lista plana directa sin Hero ficticio */
            <div className="pm-stack">
              <div className="pm-day-label">
                Turnos con cancha libre para este partido ({slotsValidos.length}):
              </div>
              <div
                className="pm-slot-group"
              >
                {esPartidoZona && viernesNormales.length > 0 && renderDiaBloques('Viernes', viernesNormales)}
                {esPartidoZona && viernesMadrugada.length > 0 && renderDiaBloques('Sábado (madrugada)', viernesMadrugada)}
                {esPartidoZona && sabadoNormales.length > 0 && renderDiaBloques('Sábado', sabadoNormales)}
                {esPartidoZona && sabadoMadrugada.length > 0 && renderDiaBloques('Domingo (madrugada)', sabadoMadrugada)}
                {esDieciseisavos && sabadoNormales.length > 0 && renderDiaBloques('Sábado (noche)', sabadoNormales)}
                {esDieciseisavos && sabadoMadrugada.length > 0 && renderDiaBloques('Domingo (madrugada)', sabadoMadrugada)}
                {domingoViables.length > 0 && renderDiaBloques('Domingo', domingoViables)}
              </div>
            </div>
          ) : (
            /* Vista clásica para Partidos de Zona con ranking de cercanía y disponibilidad */
            <div className="pm-stack pm-schedule-options">
              {/* Sugerencia Óptima (Hero) */}
              <div className="pm-recommendation">
                <div
                  className="pm-recommendation-label"
                >
                  <Star size={11} className="pm-brand-icon" /> Mejor opción
                </div>
                {renderOptionRow(heroOption, true)}
              </div>

              {/* Alternativas (#2..N) */}
              {restoAlternativasCount > 0 && (
                <div>
                  <button
                    type="button"

                    className="pm-text-button"
                    onClick={() => setShowAlternativas((prev) => !prev)}
                  >
                    {showAlternativas ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    <span>
                      {showAlternativas
                        ? 'Ocultar alternativas'
                        : `Ver alternativas (${alternativas.length})`}
                    </span>
                  </button>

                  {showAlternativas && (
                    <div className="pm-stack">
                      {alternativas.map((opt) => renderOptionRow(opt, false))}
                    </div>
                  )}
                </div>
              )}

              {/* Salida de último recurso: Grilla completa del club (Accionable en 1-click) */}
              <div className="pm-other-slots">
                <button
                  type="button"

                  className="pm-text-button"
                  onClick={() => setShowTodosViables((prev) => !prev)}
                >
                  {showTodosViables
                    ? 'Ocultar todos los turnos del club'
                    : `+ Ver todos los turnos con cancha libre del club (${slotsValidos.length})`}
                </button>

                {showTodosViables && (
                  <div
                    className="pm-slot-group"
                  >
                    {viernesNormales.length > 0 && renderDiaBloques('Viernes', viernesNormales)}
                    {viernesMadrugada.length > 0 && renderDiaBloques('Sábado (madrugada)', viernesMadrugada)}
                    {sabadoNormales.length > 0 && renderDiaBloques('Sábado', sabadoNormales)}
                    {sabadoMadrugada.length > 0 && renderDiaBloques('Domingo (madrugada)', sabadoMadrugada)}
                    {domingoViables.length > 0 && renderDiaBloques('Domingo', domingoViables)}
                  </div>
                )}
              </div>
            </div>
          )}
          </div>
        )}

        </div>
        {/* Footer */}
        <div className="pm-footer">
          {advertenciasAsignacion ? (
            <button type="button" className="pm-button pm-primary" onClick={handleCerrarModal}>
              Entendido
            </button>
          ) : (
            <button type="button" className="pm-button" onClick={handleCerrarModal} disabled={Boolean(guardandoSlotId)}>
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
