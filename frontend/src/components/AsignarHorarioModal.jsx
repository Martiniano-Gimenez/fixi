import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Star, Users, ChevronDown, ChevronUp, Loader2, AlertTriangle, X } from 'lucide-react';
import { formatAjusteTiempo, minutosCronologicosJornada } from '../utils/dateUtils';
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

  // FILTRADO ESTRICTO DE FACTIBILIDAD Y CONTEXTO:
  // 1. Hay al menos una cancha libre
  // 2. Corresponde al día permitido según el contexto del partido
  // 3. Ninguna de las 2 parejas tiene otro partido en simultáneo
  const slotsValidos = rawSlots.filter((s) => {
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

  // Ranking inteligente idéntico a preCheck (certeza -> menor distancia total -> balance)
  const rankedSlots = rankearSlotsParaPartido(slotsValidos, slotsP1, slotsP2);

  const heroOption = rankedSlots[0];
  const alternativas = rankedSlots.slice(1, 6);
  const restoAlternativasCount = Math.max(0, rankedSlots.length - 1);

  const viernesViables = slotsValidos.filter((s) => s.dia === 'Viernes');
  const sabadoViables = slotsValidos.filter((s) => s.dia === 'Sabado');
  const domingoViables = slotsValidos.filter((s) => s.dia === 'Domingo');

  const p1Nombre = partido.pareja1 ? `${partido.pareja1.jugador1} / ${partido.pareja1.jugador2}` : 'Pareja 1';
  const p2Nombre = partido.pareja2 ? `${partido.pareja2.jugador1} / ${partido.pareja2.jugador2}` : 'Pareja 2';

  // Jerarquía visual dinámica por disponibilidad (terciles sobre valores presentes)
  const allLibresCounts = slotsValidos.map((s) => s.canchasLibres?.length || 0);
  const maxLibres = allLibresCounts.length > 0 ? Math.max(...allLibresCounts) : 0;
  const minLibres = allLibresCounts.length > 0 ? Math.min(...allLibresCounts) : 0;

  const getDisponibilidadTier = (canchasCount) => {
    const range = maxLibres - minLibres;
    // Si la dispersión es <= 1 (ej. todos 2, o 6 y 5), no penalizamos: todos quedan estándar
    if (range <= 1) return 'tier-mid';
    // Si la dispersión es >= 2, distribuimos según terciles relativos (fallback limpio a 2 niveles si hay pocos datos)
    if (canchasCount >= minLibres + (range * 2) / 3) return 'tier-high';
    if (canchasCount <= minLibres + range / 3) return 'tier-low';
    return 'tier-mid';
  };

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
    const tierClass = getDisponibilidadTier(s.canchasLibres?.length || 0);

    return (
      <button
        key={s.slotId}
        type="button"
        disabled={Boolean(guardandoSlotId)}
        className={`slot-chip ${tierClass}`}
        style={{
          padding: '0.25rem 0.5rem',
          fontSize: '11px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          minHeight: '28px',
        }}
        onClick={() => handleAsignar(s)}
        title={`Asignar ${s.slotId} (${s.canchasLibres?.length || 0} canchas libres)`}
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
          padding: isHero ? '0.6rem 0.75rem' : '0.45rem 0.6rem',
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
            gap: '0.75rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontSize: isHero ? 'var(--font-size-sm)' : 'var(--font-size-xs)',
              flex: 1,
            }}
          >
            {isCasiEstrellaDoble ? (
              <Users size={14} style={{ color: '#38bdf8', flexShrink: 0 }} />
            ) : (
              <Star size={14} style={{ color: '#eab308', fill: '#eab308', flexShrink: 0 }} />
            )}
            <strong style={{ color: 'var(--color-text)' }}>
              {opt.dia} {opt.hora}
            </strong>
            <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              ({opt.canchasLibres.length} {opt.canchasLibres.length === 1 ? 'lib.' : 'lib.'})
            </span>
            <ChevronDown
              size={12}
              style={{
                color: 'var(--color-text-secondary)',
                opacity: 0.6,
                transform: isExpanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s ease',
                marginLeft: '0.1rem',
              }}
            />
          </div>

          <div>
            <button
              type="button"
              className={isHero ? 'btn-primary' : 'btn-secondary'}
              disabled={Boolean(guardandoSlotId)}
              style={{
                padding: '0.3rem 0.8rem',
                fontSize: '11px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                minHeight: '28px',
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.6rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-text)' }}>
              {partido.fechaHora ? 'Reprogramar horario y cancha' : 'Asignar horario y cancha libre'}
            </h3>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              {partido.categoria?.nombre} · {partido.zona?.nombre || 'Zona'}
            </span>
          </div>
          <button type="button" className="btn-link-action" onClick={onClose} style={{ color: 'var(--color-text-secondary)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Info del partido */}
        <div style={{ padding: '0.65rem 0.85rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', marginBottom: '0.85rem' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
            {p1Nombre} vs {p2Nombre}
          </div>
          {slotsEnComunOriginales.length > 0 && slotsEnComunDisponibles.length === 0 ? (
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
          ) : null}
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
          ) : rankedSlots.length === 0 ? (
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
                  No hay turnos disponibles donde haya cancha libre y ambas parejas no estén jugando
                </strong>
                <p style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                  En todos los turnos del torneo las canchas están 100% ocupadas por otros partidos o alguna de las dos parejas ya tiene un partido asignado en simultáneo.
                </p>
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
              </div>
            </div>
          ) : (
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
                    {renderDiaBloques('Viernes', viernesViables)}
                    {renderDiaBloques('Sábado', sabadoViables)}
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
