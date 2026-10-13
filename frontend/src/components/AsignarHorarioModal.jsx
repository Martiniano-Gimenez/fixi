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

  const [expandedSlotId, setExpandedSlotId] = useState(null);

  useEffect(() => {
    if (isOpen && torneoId) {
      cargarCanchasDisponibles();
      setGuardandoSlotId(null);
      setError('');
      setShowAlternativas(false);
      setShowTodosViables(false);
      setExpandedSlotId(null);
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
      // Dieciseisavos: Sábado noche (a partir de 18:00hs o trasnoche) o Domingo
      if (s.dia === 'Sabado') {
        return minutosCronologicosJornada(s.hora) >= HORA_INICIO_NOCHE_DIECISEISAVOS * 60;
      }
      return s.dia === 'Domingo';
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
      ? (partido.origenPareja2 ? `Esperando ${partido.origenPareja2}` : 'Esperando clasificado...')
      : (partido.origenPareja1 ? `Esperando ${partido.origenPareja1}` : 'Esperando clasificado...');
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
        className="slot-chip"
        style={{
          padding: '0.25rem 0.5rem',
          fontSize: '11px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          minHeight: '28px',
        }}
        onClick={() => handleAsignar(s)}
        title={`Asignar ${formatSlotCalendario(s.slotId)} (${s.canchasLibres?.length || 0} canchas libres)`}
      >
        {isApplying ? (
          <>
            <Loader2 size={10} className="spin" /> {s.hora}
          </>
        ) : (
          `${s.hora} (${s.canchasLibres.length} lib.)`
        )}
      </button>
    );
  };

  const renderDiaBloques = (diaNombre, slots) => {
    if (!slots || slots.length === 0) return null;
    const bloques = agruparSlotsEnBloques(slots);

    return (
      <div style={{ marginBottom: '0.45rem' }}>
        <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>
          {diaNombre}:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {bloques.map((bloque, bIdx) => (
            <div key={bIdx} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {bIdx > 0 && (
                <div
                  style={{
                    borderTop: '1px dashed rgba(255, 255, 255, 0.1)',
                    margin: '0.2rem 0',
                  }}
                />
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {bloque.map(renderSlotChip)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
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
      await api.put(`/partidos/${partido.id}/asignar-horario-manual`, {
        slotId: opt.slotId,
        canchaNumero: cancha,
      });
      if (onAssigned) onAssigned();
      onClose();
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
        style={{
          padding: isHero ? '0.55rem 0.65rem' : '0.45rem 0.55rem',
          background: isHero ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.01)',
          border: isHero ? '1px solid rgba(234, 179, 8, 0.35)' : '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
          cursor: 'pointer',
          transition: 'border-color 0.15s ease, background-color 0.15s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: isHero ? 'var(--font-size-sm)' : 'var(--font-size-xs)',
              flex: 1,
              minWidth: 0,
            }}
          >
            {isCasiEstrellaDoble ? (
              <Users size={14} style={{ color: '#38bdf8', flexShrink: 0 }} />
            ) : (
              <Star size={14} style={{ color: '#eab308', fill: '#eab308', flexShrink: 0 }} />
            )}
            <strong style={{ color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
              {formatSlotCalendario(opt.slotId)}
            </strong>
            <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
              ({opt.canchasLibres.length} lib.)
            </span>
            <ChevronDown
              size={12}
              style={{
                flexShrink: 0,
                color: 'var(--color-text-secondary)',
                opacity: 0.6,
                transform: isExpanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s ease',
              }}
            />
          </div>

          <div style={{ flexShrink: 0 }}>
            <button
              type="button"
              className={isHero ? 'btn-primary' : 'btn-secondary'}
              disabled={Boolean(guardandoSlotId)}
              style={{
                padding: '0.25rem 0.65rem',
                fontSize: '11px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                minHeight: '28px',
                whiteSpace: 'nowrap',
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleAsignar(opt);
              }}
            >
              {isThisApplying ? (
                <>
                  <Loader2 size={11} className="spin" /> Asignando...
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
            style={{
              paddingTop: '0.35rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.35,
              wordBreak: 'break-word',
            }}
          >
            {textDetails}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text)', lineHeight: 1.25 }}>
              {partido.fechaHora ? 'Reprogramar horario y cancha' : 'Asignar horario y cancha libre'}
            </h3>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              {partido.categoria?.nombre} · {contextoNombre}
            </span>
          </div>
          <button type="button" className="btn-link-action" onClick={onClose} style={{ color: 'var(--color-text-secondary)', padding: '0.25rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Info del partido */}
        <div style={{ padding: '0.65rem 0.85rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', marginBottom: '0.85rem' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
            {cruceTexto}
          </div>

          {partido.fechaHora && (
            <div
              style={{
                marginTop: '0.45rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '11.5px',
                color: 'var(--color-text-secondary)',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--color-border)',
                padding: '0.25rem 0.6rem',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <Clock size={12} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
              <span>
                <strong style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Actualmente:</strong>{' '}
                <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>
                  {formatDiaHorario(partido.fechaHora)}
                  {partido.canchaNumero ? ` · Cancha ${partido.canchaNumero}` : ''}
                </span>
              </span>
            </div>
          )}

          {!esPartidoEliminatoria && !esSinParejasDefinidas && (
            slotsEnComunOriginales.length > 0 && slotsEnComunDisponibles.length === 0 ? (
              <div
                style={{
                  marginTop: '0.35rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '11px',
                  color: 'var(--color-warning)',
                  background: 'rgba(245, 158, 11, 0.08)',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                }}
                title="Coincidían en disponibilidad pero las canchas están 100% ocupadas en esos turnos"
              >
                <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                <span>Coincidían en {slotsEnComunOriginales.length} {slotsEnComunOriginales.length === 1 ? 'turno' : 'turnos'} pero sin canchas libres</span>
              </div>
            ) : slotsEnComunOriginales.length === 0 ? (
              <div
                style={{
                  marginTop: '0.35rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '11px',
                  color: 'var(--color-text-secondary)',
                  background: 'rgba(255, 255, 255, 0.04)',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                }}
                title="Ambas parejas no tienen ninguna ventana horaria en común declarada"
              >
                <Users size={12} style={{ flexShrink: 0 }} />
                <span>Sin coincidencia horaria directa</span>
              </div>
            ) : null
          )}

          {esSinParejasDefinidas && (
            <div
              style={{
                marginTop: '0.35rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '11px',
                color: 'var(--color-text-secondary)',
                background: 'rgba(255, 255, 255, 0.04)',
                padding: '0.2rem 0.5rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
              }}
            >
              <Clock size={12} style={{ flexShrink: 0 }} />
              <span>Cruce pendiente de resultados previos. Podés fijar o cambiar su horario y cancha anticipadamente.</span>
            </div>
          )}
        </div>

        {error && (
          <div className="error-message" style={{ marginBottom: '0.75rem', fontSize: '11px' }}>
            {error}
          </div>
        )}

        {/* Contenido principal */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.25rem' }}>
          {loadingCanchas ? (
            <div className="loading" style={{ padding: '2rem' }}>
              <Loader2 size={18} className="spin" /> Consultando canchas y disponibilidad en tiempo real...
            </div>
          ) : slotsValidos.length === 0 ? (
            <div
              style={{
                padding: '1.25rem',
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
              }}
            >
              <AlertTriangle size={22} color="var(--color-warning)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ color: 'var(--color-warning)', fontSize: 'var(--font-size-sm)', display: 'block', marginBottom: '0.3rem' }}>
                  {esPartidoEliminatoria
                    ? 'No hay turnos con cancha disponible para este cruce de playoffs'
                    : 'No hay turnos disponibles donde haya cancha libre y ambas parejas no estén jugando'}
                </strong>
                <p style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                  {esPartidoEliminatoria
                    ? 'Todas las canchas del club están 100% ocupadas en los horarios correspondientes a esta fase.'
                    : 'En todos los turnos del torneo las canchas están 100% ocupadas por otros partidos o alguna de las dos parejas ya tiene un partido asignado en simultáneo.'}
                </p>
                {!esPartidoEliminatoria && (
                  <div style={{ marginTop: '0.6rem' }}>
                    <Link
                      to={`/admin/torneos/${torneoId}/categorias/${partido.categoriaId || partido.categoria?.id}/parejas`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--color-primary)',
                        textDecoration: 'none',
                        fontWeight: 600,
                      }}
                    >
                      Ir a Gestionar Parejas de {partido.categoria?.nombre || 'la Categoría'} →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ) : (esPartidoEliminatoria || esSinParejasDefinidas) ? (
            /* Vista simplificada para Eliminatorias / Bracket o Partidos sin parejas confirmadas: lista plana directa sin Hero ficticio */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.15rem' }}>
                Turnos con cancha libre para este partido ({slotsValidos.length}):
              </div>
              <div
                style={{
                  padding: '0.55rem 0.75rem',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                }}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {/* Sugerencia Óptima (Hero) */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    color: '#eab308',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: '0.3rem',
                  }}
                >
                  <Star size={11} style={{ fill: '#eab308' }} /> MEJOR OPCIÓN
                </div>
                {renderOptionRow(heroOption, true)}
              </div>

              {/* Alternativas (#2..N) */}
              {restoAlternativasCount > 0 && (
                <div>
                  <button
                    type="button"
                    className="btn-link-action"
                    style={{
                      padding: '0.2rem 0',
                      fontSize: '11px',
                      color: 'var(--color-text-secondary)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
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
                    <div style={{ marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {alternativas.map((opt) => renderOptionRow(opt, false))}
                    </div>
                  )}
                </div>
              )}

              {/* Salida de último recurso: Grilla completa del club (Accionable en 1-click) */}
              <div style={{ marginTop: '0.4rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.6rem' }}>
                <button
                  type="button"
                  className="btn-link-action"
                  style={{
                    padding: 0,
                    fontSize: '11px',
                    color: 'var(--color-text-secondary)',
                    textDecoration: 'underline',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                  onClick={() => setShowTodosViables((prev) => !prev)}
                >
                  {showTodosViables
                    ? 'Ocultar todos los turnos del club'
                    : `+ Ver todos los turnos con cancha libre del club (${slotsValidos.length})`}
                </button>

                {showTodosViables && (
                  <div
                    style={{
                      marginTop: '0.4rem',
                      padding: '0.5rem',
                      background: 'rgba(255, 255, 255, 0.02)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-border)',
                    }}
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

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.65rem', borderTop: '1px solid var(--color-border)', marginTop: '0.4rem' }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={Boolean(guardandoSlotId)}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
