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
      <div className="pc-muted pc-spaced">
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
        className={`pc-option${isHero ? ' is-hero' : ''}`}
      >
        <div className="pc-option-info">
          {isCasiEstrellaDoble ? (
            <Users
              size={13}
              className="pc-brand"
              title="Ambas parejas deben estirar disponibilidad"
            />
          ) : (
            <Star
              size={13}
              className="pc-star"
              title={isEstrellaMutua ? 'Horario mutuo coincidente' : '1 pareja confirmada'}
            />
          )}
          <span className="pc-option-time">
            {opt.dia} {opt.hora}
          </span>
          {textDetails && (
            <span className="pc-option-detail">
              {textDetails}
            </span>
          )}
        </div>

        <button
          type="button"
          disabled={Boolean(applyingSlotId)}
          className="pc-button"
          onClick={() => handleResolver(opt)}
          title={`Resolver cruce asignando ${opt.slotId}`}
        >
          {isThisApplying ? (
            <>
              <Loader2 size={11} className="pc-spin" /> Resolviendo…
            </>
          ) : (
            'Resolver'
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="pc-resolver">
      {/* Opción Hero (#1) */}
      {renderOptionRow(heroOption, true)}

      {error && (
        <div className="pc-notice pc-danger-notice">
          {error}
        </div>
      )}

      {/* Alternativas (#2..N) - solo si hay más de 1 opción */}
      {alternativas.length > 0 && (
        <div className="pc-alternatives">
          <button
            type="button"
            className="pc-link"
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
            <div className="pc-alternative-list">
              {alternativas.map((opt) => renderOptionRow(opt, false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
