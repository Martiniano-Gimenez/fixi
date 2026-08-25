import { useState } from 'react';
import { api } from '../api/client';
import { Star, Users, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { formatAjusteTiempo } from '../utils/dateUtils';

export default function CruceResolver({
  opcionesResolucion = [],
  pareja1Id,
  pareja2Id,
  pareja1Nombre,
  pareja2Nombre,
  onApplied,
}) {
  const [showAlternativas, setShowAlternativas] = useState(false);
  const [applyingSlotId, setApplyingSlotId] = useState(null);
  const [error, setError] = useState('');

  if (!Array.isArray(opcionesResolucion) || opcionesResolucion.length === 0) {
    return (
      <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontStyle: 'italic', margin: '0.25rem 0' }}>
        Sin opciones automáticas — abrí Gestionar Parejas para coordinar manualmente
      </div>
    );
  }

  const heroOption = opcionesResolucion[0];
  const alternativas = opcionesResolucion.slice(1);

  const handleResolver = async (opt) => {
    if (!pareja1Id || !pareja2Id || applyingSlotId) return;
    setApplyingSlotId(opt.slotId);
    setError('');

    const slotsToAdd1 = opt.addToP1 ? [opt.slotId] : [];
    const slotsToAdd2 = opt.addToP2 ? [opt.slotId] : [];

    try {
      await api.put('/parejas/disponibilidad-doble', {
        parejaId1: pareja1Id,
        slotsToAdd1,
        parejaId2: pareja2Id,
        slotsToAdd2,
      });

      if (onApplied) {
        await onApplied({
          pareja1Id,
          pareja2Id,
          slotId: opt.slotId,
          distP1: opt.distP1,
          distP2: opt.distP2,
          addToP1: opt.addToP1,
          addToP2: opt.addToP2,
          label: `${opt.dia} ${opt.hora}`,
        });
      }
    } catch (err) {
      setError(err.message || 'Error al resolver horario.');
    } finally {
      setApplyingSlotId(null);
    }
  };

  const renderOptionRow = (opt, isHero = false) => {
    const isThisApplying = applyingSlotId === opt.slotId;
    const isEstrellaMutua = !opt.addToP1 && !opt.addToP2;
    const isCasiEstrellaDoble = opt.addToP1 && opt.addToP2;
    const isEstrellaClasica = !isEstrellaMutua && !isCasiEstrellaDoble;

    let textDetails = null;
    if (isCasiEstrellaDoble) {
      const p1 = pareja1Nombre || 'Pareja 1';
      const p2 = pareja2Nombre || 'Pareja 2';
      textDetails = `— ${p1} ${formatAjusteTiempo(opt.distP1)}, ${p2} ${formatAjusteTiempo(opt.distP2)}`;
    } else if (isEstrellaClasica) {
      const parejaQueEstira = opt.addToP1 ? (pareja1Nombre || 'Pareja 1') : (pareja2Nombre || 'Pareja 2');
      const distQueEstira = opt.addToP1 ? opt.distP1 : opt.distP2;
      textDetails = `— ${parejaQueEstira} ${formatAjusteTiempo(distQueEstira)}`;
    }

    return (
      <div
        key={opt.slotId}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          padding: isHero ? '0.35rem 0' : '0.25rem 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: 'var(--font-size-xs)' }}>
          {isCasiEstrellaDoble ? (
            <Users
              size={13}
              style={{ color: '#38bdf8', flexShrink: 0 }}
              title="Ambas parejas deben estirar disponibilidad"
            />
          ) : (
            <Star
              size={13}
              style={{ color: '#eab308', fill: '#eab308', flexShrink: 0 }}
              title={isEstrellaMutua ? 'Horario mutuo coincidente' : '1 pareja confirmada'}
            />
          )}
          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
            {opt.dia} {opt.hora}
          </span>
          {textDetails && (
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px' }}>
              {textDetails}
            </span>
          )}
        </div>

        <button
          type="button"
          className="btn-secondary"
          disabled={Boolean(applyingSlotId)}
          style={{
            padding: '0.2rem 0.6rem',
            fontSize: '11px',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
          onClick={() => handleResolver(opt)}
          title={`Resolver cruce asignando ${opt.slotId}`}
        >
          {isThisApplying ? (
            <>
              <Loader2 size={11} className="spin" /> Resolviendo...
            </>
          ) : (
            'Resolver'
          )}
        </button>
      </div>
    );
  };

  return (
    <div style={{ margin: '0.35rem 0', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      {/* Opción Hero (#1) */}
      {renderOptionRow(heroOption, true)}

      {error && (
        <div className="error-message" style={{ fontSize: '11px', margin: '0.2rem 0' }}>
          {error}
        </div>
      )}

      {/* Alternativas (#2..N) - solo si hay más de 1 opción */}
      {alternativas.length > 0 && (
        <div style={{ marginTop: '0.15rem' }}>
          <button
            type="button"
            className="btn-link-action"
            style={{
              padding: '0.15rem 0',
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
                ? 'Ocultar opciones'
                : `Ver ${alternativas.length} ${alternativas.length === 1 ? 'opción más' : 'opciones más'}`}
            </span>
          </button>

          {showAlternativas && (
            <div
              style={{
                marginTop: '0.25rem',
                paddingLeft: '0.75rem',
                borderLeft: '2px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.2rem',
              }}
            >
              {alternativas.map((opt) => renderOptionRow(opt, false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
